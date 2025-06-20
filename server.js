// server.js - Updated with environment-specific configuration
// Load environment variables first
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Telegraf, Markup, Scenes, session } = require("telegraf");
const { message } = require("telegraf/filters");
const fastify = require("fastify")({ 
  logger: process.env.NODE_ENV === 'production' ? { level: 'info' } : true 
});
const handlebars = require("handlebars");

// Import configurations
const telegramConfig = require("./config/telegram");
const dbConfig = require("./config/database");

// Import the database functions
const db = require("./src/messagesDb");

// Environment-specific logging
function logWithEnv(message, ...args) {
  console.log(`[${dbConfig.environment.toUpperCase()}] ${message}`, ...args);
}

// Telegram Bot Setup
let recordingHasStarted = false;
let isPaused = false;
let currentSessionId = null;
let awaitingSessionTitle = false;
let bot = null;

// Improved Telegram bot initialization with environment support
function initializeTelegramBot() {
  if (!telegramConfig.token || telegramConfig.disabled) {
    logWithEnv(`Telegram bot disabled - token: ${!!telegramConfig.token}, disabled: ${telegramConfig.disabled}`);
    return null;
  }

  // Debug token info (be careful in production)
  if (dbConfig.isDevelopment) {
    logWithEnv('Telegram Debug:');
    console.log('- Environment:', dbConfig.environment);
    console.log('- Token exists:', !!telegramConfig.token);
    console.log('- Token length:', telegramConfig.token?.length);
    console.log('- Token preview:', telegramConfig.token?.substring(0, 10) + "...");
  }

  try {
    bot = new Telegraf(telegramConfig.token);

    // Enable session management for the bot
    bot.use(session());

    // Set up all bot handlers
    setupBotHandlers();

    // Launch the bot
    bot
      .launch()
      .then(() => {
        logWithEnv("Telegram bot started successfully");
      })
      .catch((err) => {
        console.error(`❌ [${dbConfig.environment}] Failed to start Telegram bot:`, err.message);
        bot = null;
      });

    // Graceful stop handlers
    process.once("SIGINT", () => {
      if (bot) {
        logWithEnv("Stopping Telegram bot...");
        bot.stop("SIGINT");
      }
    });
    process.once("SIGTERM", () => {
      if (bot) {
        logWithEnv("Stopping Telegram bot...");
        bot.stop("SIGTERM");
      }
    });

    return bot;
  } catch (error) {
    console.error(`❌ [${dbConfig.environment}] Failed to initialize Telegram bot:`, error.message);
    return null;
  }
}

// Function to generate a unique session ID with environment prefix
function generateSessionId() {
  const envPrefix = dbConfig.environment === 'production' ? 'prod' : 
                   dbConfig.environment === 'test' ? 'test' : 'dev';
  return `${envPrefix}_session_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// Function to setup all bot handlers (same as before, but with environment logging)
function setupBotHandlers() {
  if (!bot) return;

  // Create the keyboard layouts
  const startRecordingKeyboard = Markup.keyboard([
    [Markup.button.text("🎙️ START RECORDING")],
  ]).resize();

  const activeRecordingKeyboard = Markup.keyboard([
    [
      Markup.button.text("⏸️ PAUSE RECORDING"),
      Markup.button.text("⏹️ STOP RECORDING"),
    ],
  ]).resize();

  const pausedRecordingKeyboard = Markup.keyboard([
    [
      Markup.button.text("▶️ RESUME RECORDING"),
      Markup.button.text("⏹️ STOP RECORDING"),
    ],
  ]).resize();

  // Bot commands
  bot.start((ctx) => {
    const welcomeMessage = dbConfig.isDevelopment ? 
      "🔧 Development Bot: Ready to start recording!" :
      "Yo! I'm ready whenever you are. Press the button to start recording.";
    
    ctx.reply(welcomeMessage, startRecordingKeyboard);
  });

  // Function to handle session recording start
  async function startRecording(ctx) {
    recordingHasStarted = false;
    isPaused = false;
    awaitingSessionTitle = true;
    currentSessionId = generateSessionId();

    logWithEnv(`Starting new recording session: ${currentSessionId}`);
    ctx.reply("Please enter a title for this recording session:");
  }

  // Function to finalize session start after getting the title
  async function finalizeSessionStart(ctx, title) {
    try {
      await db.saveSession({
        session_id: currentSessionId,
        title: title,
        created_at: new Date().toISOString(),
        status: "active",
      });

      recordingHasStarted = true;
      awaitingSessionTitle = false;

      const successMessage = `Recording started!\nSession: "${title}" (${currentSessionId})\nEnvironment: ${dbConfig.environment}`;
      ctx.reply(successMessage, activeRecordingKeyboard);
      
      logWithEnv(`Session started successfully: ${currentSessionId}`);
    } catch (error) {
      console.error(`[${dbConfig.environment}] Error starting session:`, error);
      ctx.reply(
        "Failed to start recording session. Please try again.",
        startRecordingKeyboard
      );
      recordingHasStarted = false;
      awaitingSessionTitle = false;
      currentSessionId = null;
    }
  }

  // Handle the button presses (same logic as before)
  bot.hears("🎙️ START RECORDING", (ctx) => {
    startRecording(ctx);
  });

  bot.hears("⏸️ PAUSE RECORDING", async (ctx) => {
    if (recordingHasStarted && !isPaused) {
      isPaused = true;

      try {
        const session = await db.getSession(currentSessionId);
        if (session) {
          await db.saveSession({
            ...session,
            status: "paused",
          });
        }
        logWithEnv(`Session paused: ${currentSessionId}`);
      } catch (error) {
        console.error(`[${dbConfig.environment}] Error updating session status:`, error);
      }

      ctx.reply(
        `Recording paused. Session is on hold. Press resume to continue recording in this session.`,
        pausedRecordingKeyboard
      );
    }
  });

  bot.hears("▶️ RESUME RECORDING", async (ctx) => {
    if (recordingHasStarted && isPaused) {
      isPaused = false;

      try {
        const session = await db.getSession(currentSessionId);
        if (session) {
          await db.saveSession({
            ...session,
            status: "active",
          });
        }
        logWithEnv(`Session resumed: ${currentSessionId}`);
      } catch (error) {
        console.error(`[${dbConfig.environment}] Error updating session status:`, error);
      }

      ctx.reply(
        `Recording resumed. Continuing session.`,
        activeRecordingKeyboard
      );
    }
  });

  bot.hears("⏹️ STOP RECORDING", async (ctx) => {
    if (recordingHasStarted) {
      const lastSessionId = currentSessionId;

      try {
        if (lastSessionId) {
          logWithEnv(`Stopping recording for session: ${lastSessionId}`);

          const currentSession = await db.getSession(lastSessionId);
          
          await db.saveSession({
            session_id: lastSessionId,
            status: "completed",
          });

          const updatedSession = await db.getSession(lastSessionId);
          logWithEnv(`Session completed: ${lastSessionId}, Status: ${updatedSession?.status}`);

          ctx.reply(
            `Recording stopped. Session completed successfully. Press the button to start a new session.`,
            startRecordingKeyboard
          );
        }
      } catch (error) {
        console.error(`[${dbConfig.environment}] Error updating session status on stop:`, error);
        ctx.reply(
          `Recording stopped. Note: There was an error updating the session status.`,
          startRecordingKeyboard
        );
      } finally {
        recordingHasStarted = false;
        isPaused = false;
        currentSessionId = null;
      }
    } else {
      ctx.reply("No active recording to stop.", startRecordingKeyboard);
    }
  });

  // Handle text messages
  bot.on(message("text"), async (ctx) => {
    // Check if we're waiting for a session title
    if (awaitingSessionTitle) {
      const title = ctx.message.text.trim();

      if (!title) {
        ctx.reply("Please enter a valid title for the session:");
        return;
      }

      await finalizeSessionStart(ctx, title);
      return;
    }

    // Ignore the keyboard button messages
    if (
      [
        "🎙️ START RECORDING",
        "⏸️ PAUSE RECORDING",
        "▶️ RESUME RECORDING",
        "⏹️ STOP RECORDING",
      ].includes(ctx.message.text)
    ) {
      return;
    }

    if (recordingHasStarted && !isPaused && currentSessionId) {
      try {
        const session = await db.getSession(currentSessionId);
        const sessionTitle = session ? session.title : null;

        const msgToSave = {
          chat_id: ctx.chat.id.toString(),
          session_id: currentSessionId,
          session_title: sessionTitle,
          date: new Date(ctx.message.date * 1000).toISOString(),
          username: ctx.from.username || "Anonymous",
          message: ctx.message.text,
        };

        await db.saveMessage(msgToSave);
        logWithEnv(`Message saved for session ${currentSessionId}:`, msgToSave.message.substring(0, 50) + "...");

        // React with eye emoji to the original message
        try {
          await ctx.telegram.setMessageReaction(
            ctx.chat.id,
            ctx.message.message_id,
            [{ type: "emoji", emoji: "👀" }]
          );
        } catch (error) {
          console.error(`[${dbConfig.environment}] Error setting reaction:`, error);
        }
      } catch (error) {
        console.error(`[${dbConfig.environment}] Error processing message:`, error);
      }
    } else if (recordingHasStarted && isPaused) {
      ctx.reply(
        "Recording is currently paused. Press the resume button to continue recording.",
        pausedRecordingKeyboard
      );
    } else if (!awaitingSessionTitle) {
      const envNote = dbConfig.isDevelopment ? " (Development Mode)" : "";
      ctx.reply(
        `Recording is not started${envNote}. Use the button to start recording.`,
        startRecordingKeyboard
      );
    }
  });
}

// ... (rest of the handlebars helpers remain the same)

// Fastify server setup with environment-specific configuration
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/",
});
fastify.register(require("@fastify/formbody"));
fastify.register(require("@fastify/view"), {
  engine: {
    handlebars: handlebars,
  },
  templates: path.join(__dirname, "src/views"),
});
fastify.register(require("@fastify/cors"));

// Add environment info endpoint
fastify.get("/api/environment", async (request, reply) => {
  return {
    environment: dbConfig.environment,
    database: {
      path: dbConfig.current.messages,
      isDevelopment: dbConfig.isDevelopment,
      isProduction: dbConfig.isProduction
    },
    telegram: {
      enabled: !telegramConfig.disabled,
      hasToken: !!telegramConfig.token,
      environment: telegramConfig.environment
    },
    timestamp: new Date().toISOString()
  };
});

// Add health check endpoint
fastify.get('/health', async (request, reply) => {
  return { 
    status: 'healthy', 
    environment: dbConfig.environment,
    timestamp: new Date().toISOString(),
    database: 'connected',
    telegram: bot ? 'connected' : 'disconnected'
  };
});

// ... (all existing endpoints remain the same)

// Enhanced startup with environment logging
const start = async () => {
  try {
    logWithEnv("=".repeat(50));
    logWithEnv(`Starting ChatCast in ${dbConfig.environment.toUpperCase()} mode`);
    logWithEnv("=".repeat(50));
    
    // Verify database configuration
    logWithEnv(`Database configuration:`);
    console.log(`- Messages DB: ${dbConfig.current.messages}`);
    console.log(`- Environment: ${dbConfig.environment}`);
    
    // Verify and repair database if needed
    if (typeof db.verifyAndRepairDatabase === "function") {
      await db.verifyAndRepairDatabase();
    }

    // Run initial session status check
    if (typeof db.checkAndFixSessionStatuses === "function") {
      logWithEnv("Running initial session status check...");
      try {
        const result = await db.checkAndFixSessionStatuses();
        logWithEnv(`Initial session status check: checked ${result.checked}, updated ${result.updated}`);
      } catch (err) {
        console.error(`[${dbConfig.environment}] Error in initial session status check:`, err);
      }
    }

    // Start the server
    const port = process.env.PORT || (dbConfig.isDevelopment ? 3000 : 3000);
    await fastify.listen({ port, host: "0.0.0.0" });
    logWithEnv(`Server listening on port ${port}`);

    // Initialize Telegram bot AFTER server is running
    initializeTelegramBot();

    // Set up periodic session checks (only in production)
    if (dbConfig.isProduction) {
      setInterval(async () => {
        try {
          if (typeof db.checkAndFixSessionStatuses === "function") {
            const result = await db.checkAndFixSessionStatuses();
            if (result.updated > 0) {
              logWithEnv(`Periodic session check: checked ${result.checked}, updated ${result.updated}`);
            }
          }
        } catch (err) {
          console.error(`[${dbConfig.environment}] Error in periodic session status check:`, err);
        }
      }, 30 * 60 * 1000); // Every 30 minutes in production only
    }

    logWithEnv("=".repeat(50));
    logWithEnv(`ChatCast ${dbConfig.environment.toUpperCase()} server ready!`);
    logWithEnv("=".repeat(50));

    // Graceful shutdown
    process.once("SIGINT", async () => {
      logWithEnv("Received SIGINT, stopping server...");
      await fastify.close();
      if (bot) bot.stop("SIGINT");
      await db.closeDatabase();
    });

    process.once("SIGTERM", async () => {
      logWithEnv("Received SIGTERM, stopping server...");
      await fastify.close();
      if (bot) bot.stop("SIGTERM");
      await db.closeDatabase();
    });
  } catch (err) {
    console.error(`❌ [${dbConfig.environment}] Error starting server:`, err);
    process.exit(1);
  }
};

// Run the server
start();