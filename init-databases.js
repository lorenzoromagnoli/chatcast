// init-databases.js - Environment-aware database initialization
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Load environment configuration
const dbConfig = require('./config/database');

console.log('='.repeat(60));
console.log(`Starting database initialization for ${dbConfig.environment.toUpperCase()}`);
console.log('='.repeat(60));

// Ensure directories exist
function ensureDirectoriesExist() {
  const directories = [
    'data',           // Production databases
    '.data',          // Development/test databases
    'src',            // Source directory
    path.dirname(dbConfig.current.database),
    path.dirname(dbConfig.current.messages)
  ];
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✓ Created ${dir} directory`);
    } else {
      console.log(`✓ ${dir} directory already exists`);
    }
  });
}

// Initialize messages database
function initializeMessagesDatabase() {
  return new Promise((resolve, reject) => {
    const messagesDbPath = dbConfig.current.messages;
    console.log(`Initializing messages database: ${messagesDbPath}`);
    
    const messagesDb = new sqlite3.Database(messagesDbPath, (err) => {
      if (err) {
        console.error('❌ Error creating messages database:', err);
        reject(err);
        return;
      }
      
      console.log('✓ Messages database created');
      
      messagesDb.serialize(() => {
        messagesDb.run(`CREATE TABLE IF NOT EXISTS Sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT UNIQUE,
          title TEXT,
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) console.error('❌ Error creating Sessions table:', err);
          else console.log('✓ Sessions table ready');
        });
        
        messagesDb.run(`CREATE TABLE IF NOT EXISTS Messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          chat_id TEXT,
          session_title TEXT,
          message_text TEXT,
          username TEXT,
          date TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES Sessions(session_id)
        )`, (err) => {
          if (err) console.error('❌ Error creating Messages table:', err);
          else console.log('✓ Messages table ready');
        });
        
        // Add environment-specific sample data for development
        if (dbConfig.isDevelopment) {
          const sampleSessionId = `dev_sample_${Date.now()}`;
          
          messagesDb.run(`INSERT OR IGNORE INTO Sessions 
            (session_id, title, status, created_at) 
            VALUES (?, ?, ?, ?)`, 
            [sampleSessionId, 'Sample Development Session', 'completed', new Date().toISOString()],
            (err) => {
              if (err) console.error('❌ Error creating sample session:', err);
              else console.log('✓ Sample development session created');
            }
          );
          
          const sampleMessages = [
            { username: 'DevUser1', message: 'Hello from development environment!' },
            { username: 'DevUser2', message: 'This is a sample conversation for testing.' },
            { username: 'DevUser1', message: 'Perfect! The development setup is working.' }
          ];
          
          sampleMessages.forEach((msg, index) => {
            const messageDate = new Date(Date.now() + (index * 1000)).toISOString();
            messagesDb.run(`INSERT OR IGNORE INTO Messages 
              (session_id, session_title, username, message_text, date) 
              VALUES (?, ?, ?, ?, ?)`,
              [sampleSessionId, 'Sample Development Session', msg.username, msg.message, messageDate],
              (err) => {
                if (err) console.error('❌ Error creating sample message:', err);
                else if (index === sampleMessages.length - 1) {
                  console.log('✓ Sample development messages created');
                }
              }
            );
          });
        }
      });
      
      messagesDb.close((err) => {
        if (err) {
          console.error('❌ Error closing messages database:', err);
          reject(err);
        } else {
          console.log('✓ Messages database initialization complete');
          resolve();
        }
      });
    });
  });
}

// Initialize main database (for backwards compatibility)
function initializeMainDatabase() {
  return new Promise((resolve, reject) => {
    const dbPath = dbConfig.current.database;
    console.log(`Initializing main database: ${dbPath}`);
    
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Error creating main database:', err);
        reject(err);
        return;
      }
      
      console.log('✓ Main database created');
      
      // Create basic tables if they don't exist
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS choices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          choice TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) console.error('❌ Error creating choices table:', err);
          else console.log('✓ Choices table ready');
        });
        
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT UNIQUE,
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) console.error('❌ Error creating sessions table:', err);
          else console.log('✓ Main sessions table ready');
        });
      });
      
      db.close((err) => {
        if (err) {
          console.error('❌ Error closing main database:', err);
          reject(err);
        } else {
          console.log('✓ Main database initialization complete');
          resolve();
        }
      });
    });
  });
}

// Print environment summary
function printEnvironmentSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('DATABASE INITIALIZATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Environment: ${dbConfig.environment.toUpperCase()}`);
  console.log(`Messages DB: ${dbConfig.current.messages}`);
  console.log(`Main DB: ${dbConfig.current.database}`);
  console.log(`Is Development: ${dbConfig.isDevelopment}`);
  console.log(`Is Production: ${dbConfig.isProduction}`);
  console.log(`Is Test: ${dbConfig.isTest}`);
  
  if (dbConfig.isDevelopment) {
    console.log('\n📝 Development Notes:');
    console.log('   - Sample data has been created for testing');
    console.log('   - Database files are in .data/ directory');
    console.log('   - Use npm run reset-db:dev to reset development data');
  } else if (dbConfig.isProduction) {
    console.log('\n🚀 Production Notes:');
    console.log('   - Database files are in data/ directory');
    console.log('   - Ensure data/ directory has persistent storage');
    console.log('   - Regular backups are recommended');
  } else if (dbConfig.isTest) {
    console.log('\n🧪 Test Notes:');
    console.log('   - Test database is isolated from dev/prod');
    console.log('   - Database will be cleaned between test runs');
    console.log('   - Use npm run reset-db:test to reset test data');
  }
  
  console.log('='.repeat(60));
}

// Main initialization function
async function initializeDatabases() {
  try {
    console.log(`Node Environment: ${process.env.NODE_ENV || 'undefined'}`);
    console.log(`Config Environment: ${dbConfig.environment}`);
    console.log('');
    
    // Ensure all necessary directories exist
    ensureDirectoriesExist();
    console.log('');
    
    // Initialize databases
    await initializeMessagesDatabase();
    console.log('');
    
    await initializeMainDatabase();
    console.log('');
    
    // Print summary
    printEnvironmentSummary();
    
    console.log('\n🎉 Database initialization complete!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Run initialization
initializeDatabases();