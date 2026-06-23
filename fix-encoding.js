const fs = require('fs');
let content = fs.readFileSync('assets/js/affiliate-products.json', 'utf8');
// Fix em dash in sponsored label
content = content.replace(/Sponsored .{3} Gear for Drummers/g, 'Sponsored \u2014 Gear for Drummers');
// Fix right arrow in CTA
content = content.replace(/Check Price .{3}/g, 'Check Price \u2192');
// Fix em dash in descriptions (â€”)
content = content.replace(/\u00E2\u20AC\u201D/g, ' \u2014 ');
fs.writeFileSync('assets/js/affiliate-products.json', content, 'utf8');
console.log('Fixed encoding issues');
