const fs = require('fs');
const code = fs.readFileSync('node_modules/shaka-player/dist/shaka-player.compiled.js', 'utf8');
console.log("Found clearKeys polyfill?:", code.includes('polyfill.MediaKeys'));
