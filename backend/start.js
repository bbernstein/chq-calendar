const { spawn } = require('child_process');

// Compile TypeScript
console.log('Compiling TypeScript...');
const tsc = spawn('./node_modules/.bin/tsc', {
  stdio: 'inherit'
});

tsc.on('close', (code) => {
  if (code === 0) {
    console.log('TypeScript compiled successfully, starting server...');
    // Start the server
    const server = spawn('node', ['dist/server.js'], {
      stdio: 'inherit'
    });
    
    server.on('close', (code) => {
      console.log(`Server exited with code ${code}`);
    });
  } else {
    console.error('TypeScript compilation failed');
    process.exit(1);
  }
});