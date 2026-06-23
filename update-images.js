const fs = require('fs');
let content = fs.readFileSync('assets/js/affiliate-products.json', 'utf8');

const images = {
  'B0C43R8SRB': 'https://m.media-amazon.com/images/I/8124cw60V4L._AC_SL1500_.jpg',
  'B08L8J6K31': 'https://m.media-amazon.com/images/I/51FDaCjKGlL._AC_SL1200_.jpg',
  'B000FMDIXY': 'https://m.media-amazon.com/images/I/81QQiX1-rQL._AC_SL1500_.jpg',
  'B0002F741Q': 'https://m.media-amazon.com/images/I/51N5Bm58ZtL._AC_SL1500_.jpg',
  'B00HVLUR86': 'https://m.media-amazon.com/images/I/71G5OkSr2zL._AC_SL1500_.jpg',
  'B0BQFK6ZFB': 'https://m.media-amazon.com/images/I/61jdaH+hmYL._AC_SL1500_.jpg',
  'B000UJE6UG': 'https://m.media-amazon.com/images/I/61PUiPs1o+L._AC_SL1500_.jpg',
  'B07DPLHDDY': 'https://m.media-amazon.com/images/I/71ak5UoW+GL._AC_SL1500_.jpg',
  'B0DZXYBWYD': 'https://m.media-amazon.com/images/I/71D85UJVpxL._AC_SL1500_.jpg',
  'B00967UN50': 'https://m.media-amazon.com/images/I/4192mV4sUmL._AC_SL1200_.jpg',
  'B0002W38JQ': 'https://m.media-amazon.com/images/I/81ZzA6ZrhAL._AC_SL1500_.jpg',
  'B07G7X9ZQ': 'https://placehold.co/400x250/302b63/ffffff?text=Donner+DED-200'
};

const asins = ['B0C43R8SRB','B08L8J6K31','B000FMDIXY','B0002F741Q','B00HVLUR86','B0BQFK6ZFB','B000UJE6UG','B07DPLHDDY','B0DZXYBWYD','B00967UN50','B0002W38JQ','B07G7X9ZQ'];

// Find all image URLs and replace them in order
let idx = 0;
content = content.replace(/"image": "[^"]+"/g, (match) => {
  if (idx < asins.length) {
    const asin = asins[idx];
    const newUrl = images[asin] || 'https://placehold.co/400x250/302b63/ffffff?text=Drum+Gear';
    idx++;
    return '"image": "' + newUrl + '"';
  }
  return match;
});

fs.writeFileSync('assets/js/affiliate-products.json', content, 'utf8');
console.log('Updated ' + idx + ' product images');
