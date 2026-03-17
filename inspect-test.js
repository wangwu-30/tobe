const fs = require('fs');
const files = fs.readdirSync('.tmp/iteration-regression/artifacts/test-results');
console.log(files);
