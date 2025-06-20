// src/messagesDb.js - Updated with environment-specific database paths
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");
const dbConfig = require("../config/database");

// Use environment-specific database paths
const dbFile = dbConfig.current.messages;
const exists = fs.existsSync(dbFile);

let db; // To store the database connection

// Ensure the directory exists
function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

// Initialize the database
async function initializeDb() {
  return new Promise((resolve, reject) => {
    // Ensure directory exists before creating database
    ensureDirectoryExists(dbFile);
    
    console.log(`Initializing ${dbConfig.environment} database: ${dbFile}`);
    
    db = new sqlite3.Database(dbFile, (err) => {
      if (err) {
        console.error("Error opening database:", err);
        reject(err);
        return;
      }
      
      console.log(`Database connection established for ${dbConfig.environment}`);
      
      if (!exists) {
        // Create the database from scratch (if it doesn't exist)
        db.serialize(() => {
          db.run(`
            CREATE TABLE Messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              chat_id TEXT,
              session_id TEXT,
              session_title TEXT,
              date TEXT,
              username TEXT,
              message TEXT
            )
          `, (err) => {
            if (err) console.error("Error creating Messages table:", err);
            else console.log("Messages table created");
          });
          
          // Create a separate Sessions table to store session metadata
          db.run(`
            CREATE TABLE Sessions (
              session_id TEXT PRIMARY KEY,
              title TEXT,
              created_at TEXT,
              status TEXT
            )
          `, (err) => {
            if (err) console.error("Error creating Sessions table:", err);
            else console.log("Sessions table created");
          });
        });
        
        console.log(`Database tables created for ${dbConfig.environment} with session title support.`);
        resolve();
      } else {
        // Check if the session_id column exists in Messages, if not add it
        db.all("PRAGMA table_info(Messages)", (err, messagesInfo) => {
          if (err) {
            reject(err);
            return;
          }
          
          const hasSessionId = messagesInfo.some(column => column.name === 'session_id');
          const hasSessionTitle = messagesInfo.some(column => column.name === 'session_title');
          
          if (!hasSessionId) {
            console.log("Adding session_id column to Messages table...");
            db.run("ALTER TABLE Messages ADD COLUMN session_id TEXT", (err) => {
              if (err) console.error("Error adding session_id column:", err);
              else console.log("session_id column added successfully.");
            });
          }
          
          if (!hasSessionTitle) {
            console.log("Adding session_title column to Messages table...");
            db.run("ALTER TABLE Messages ADD COLUMN session_title TEXT", (err) => {
              if (err) console.error("Error adding session_title column:", err);
              else console.log("session_title column added successfully.");
            });
          }
          
          // Check if Sessions table exists, if not create it
          db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='Sessions'", (err, tablesQuery) => {
            if (err) {
              reject(err);
              return;
            }
            
            if (tablesQuery.length === 0) {
              console.log("Creating Sessions table...");
              db.run(`
                CREATE TABLE Sessions (
                  session_id TEXT PRIMARY KEY,
                  title TEXT,
                  created_at TEXT,
                  status TEXT
                )
              `, (err) => {
                if (err) console.error("Error creating Sessions table:", err);
                else console.log("Sessions table created successfully.");
                resolve();
              });
            } else {
              resolve();
            }
          });
        });
      }
    });
  });
}

// Clean database function for testing
async function cleanDatabase() {
  if (!dbConfig.isTest) {
    throw new Error('cleanDatabase can only be called in test environment');
  }
  
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.serialize(() => {
      db.run("DELETE FROM Messages", (err) => {
        if (err) console.error("Error cleaning Messages table:", err);
      });
      
      db.run("DELETE FROM Sessions", (err) => {
        if (err) console.error("Error cleaning Sessions table:", err);
        else resolve();
      });
    });
  });
}

// Close database connection
async function closeDatabase() {
  return new Promise((resolve) => {
    if (db) {
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log(`Database connection closed for ${dbConfig.environment}`);
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Initialize database on module load
initializeDb().catch((err) => {
  console.error("Error initializing database:", err);
});

// Create or update a session
async function saveSession(sessionData) {
  return new Promise((resolve, reject) => {
    try {
      const { session_id } = sessionData;
      
      if (!session_id) {
        reject(new Error("Session ID is required"));
        return;
      }
      
      console.log(`[${dbConfig.environment}] saveSession input data:`, JSON.stringify(sessionData));
      
      // Get existing session first
      db.get("SELECT * FROM Sessions WHERE session_id = ?", [session_id], (err, existingSession) => {
        if (err) {
          reject(err);
          return;
        }
        
        let title = sessionData.title;
        let status = sessionData.status;
        let created_at = sessionData.created_at || new Date().toISOString();
        
        if (existingSession) {
          // Update existing session
          if (title === null || title === undefined) {
            title = existingSession.title;
          }
          
          if (status === null || status === undefined) {
            status = existingSession.status;
          }
          
          console.log(`[${dbConfig.environment}] Updating session ${session_id} - Title: ${title}, Status: ${status}`);
          
          db.run(
            "UPDATE Sessions SET title = ?, status = ? WHERE session_id = ?",
            [title, status, session_id],
            function(err) {
              if (err) {
                reject(err);
                return;
              }
              
              console.log(`Update result: ${this.changes} row(s) affected`);
              resolve({
                session_id,
                title,
                created_at: existingSession.created_at,
                status
              });
            }
          );
        } else {
          // Create new session
          if (!status) {
            status = 'active';
          }
          
          console.log(`[${dbConfig.environment}] Creating new session ${session_id} - Title: ${title}, Status: ${status}`);
          
          db.run(
            "INSERT INTO Sessions (session_id, title, created_at, status) VALUES (?, ?, ?, ?)",
            [session_id, title, created_at, status],
            function(err) {
              if (err) {
                reject(err);
                return;
              }
              
              console.log(`Insert result: ${this.lastID}`);
              resolve({ session_id, title, created_at, status });
            }
          );
        }
      });
    } catch (error) {
      console.error("Error saving session:", error);
      reject(error);
    }
  });
}

// Get a session by ID
async function getSession(sessionId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM Sessions WHERE session_id = ?", [sessionId], (err, row) => {
      if (err) {
        console.error("Error getting session:", err);
        resolve(null);
      } else {
        resolve(row);
      }
    });
  });
}

// Save a message to the database
async function saveMessage(messageData) {
  return new Promise((resolve, reject) => {
    try {
      const { chat_id, session_id, date, username, message } = messageData;
      let session_title = messageData.session_title;
      
      console.log(`[${dbConfig.environment}] Saving message for session: ${session_id}`);
      
      // Get session title if not provided
      if (session_id && !session_title) {
        getSession(session_id).then(session => {
          session_title = session ? session.title : null;
          
          db.run(
            `INSERT INTO Messages (chat_id, session_id, session_title, date, username, message) VALUES (?, ?, ?, ?, ?, ?)`,
            [chat_id, session_id || null, session_title || null, date, username, message],
            function(err) {
              if (err) {
                console.error("Error saving message:", err);
                reject(err);
              } else {
                resolve(this.lastID);
              }
            }
          );
        });
      } else {
        db.run(
          `INSERT INTO Messages (chat_id, session_id, session_title, date, username, message) VALUES (?, ?, ?, ?, ?, ?)`,
          [chat_id, session_id || null, session_title || null, date, username, message],
          function(err) {
            if (err) {
              console.error("Error saving message:", err);
              reject(err);
            } else {
              resolve(this.lastID);
            }
          }
        );
      }
    } catch (error) {
      console.error("Error saving message:", error);
      reject(error);
    }
  });
}

// ... (rest of the functions remain the same, just add environment logging where appropriate)

// Add environment info to existing functions
const originalGetSessionDetails = getSessionDetails;
async function getSessionDetails(sessionId) {
  try {
    console.log(`[${dbConfig.environment}] Getting details for session: ${sessionId}`);
    return await originalGetSessionDetails(sessionId);
  } catch (err) {
    console.error(`[${dbConfig.environment}] Error retrieving session details:`, err);
    return null;
  }
}

module.exports = {
  saveMessage,
  getMessages,
  getUniqueChatIds,
  getUniqueSessions,
  getMessagesBySession,
  getSessionDetails,
  getAllSessionsWithDetails,
  saveSession,
  getSession,
  getAllSessions,
  checkAndFixSessionStatuses,
  // Test utilities
  cleanDatabase,
  closeDatabase,
  // Environment info
  environment: dbConfig.environment,
  isDevelopment: dbConfig.isDevelopment,
  isProduction: dbConfig.isProduction,
  isTest: dbConfig.isTest
};
