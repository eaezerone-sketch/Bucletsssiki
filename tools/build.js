// Bundles the game into one self-contained HTML file: dist/orbita.html
// Usage: node tools/build.js
'use strict';
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
var icon = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');

var scripts = [];
html.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) {
  scripts.push('<script>\n' + fs.readFileSync(path.join(root, src), 'utf8') + '\n</script>');
});
var body = html.match(/<body>([\s\S]*?)<script/)[1].trim();
var iconUri = 'data:image/svg+xml;base64,' + Buffer.from(icon).toString('base64');

var out = [
  '<title>Орбита</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  '<meta name="theme-color" content="#05010f">',
  '<link rel="icon" href="' + iconUri + '" type="image/svg+xml">',
  '<style>\n:root { color-scheme: dark; }\n' + css + '\n</style>',
  body
].concat(scripts).join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/orbita.html'), out);
console.log('dist/orbita.html', (out.length / 1024).toFixed(1) + ' KB, ' + scripts.length + ' scripts');
