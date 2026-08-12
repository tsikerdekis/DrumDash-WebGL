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
  'B08L34HBWD': 'https://m.media-amazon.com/images/I/71Jmbl0p5sL._AC_SL1500_.jpg',
  'B08GB396C3': 'https://m.media-amazon.com/images/I/71xqagNqoWL._AC_SL1500_.jpg',
  'B00IHVQ2FQ': 'https://m.media-amazon.com/images/I/71nKgKgnGgL._AC_SL1500_.jpg',
  'B0B12CJC6G': 'https://m.media-amazon.com/images/I/81sxZDyskwL._AC_SL1500_.jpg',
  'B0CFZYG355': 'https://m.media-amazon.com/images/I/71F3RyKMzrL._AC_SX355_.jpg',
  'B0BCZFHJ12': 'https://m.media-amazon.com/images/I/7159c51DtEL._AC_SX425_.jpg',
  'B0057PK2TC': 'https://m.media-amazon.com/images/I/7105AOlchCL._AC_SX425_.jpg',
  'B0C5JRTS3Y': 'https://m.media-amazon.com/images/I/51+XSuPP7XL._AC_SX425_.jpg',
  'B0000AQRST': 'https://m.media-amazon.com/images/I/51oELchNdFL._AC_SY355_.jpg',
  'B07PJ41WPD': 'https://m.media-amazon.com/images/I/61CZuZgACcL._AC_SX425_.jpg',
  'B0002F4VIK': 'https://m.media-amazon.com/images/I/516-V+r6+ZL._AC_SY606_.jpg',
  'B08PBQFQH6': 'https://m.media-amazon.com/images/I/71fUNemtqhL._AC_SX425_PIbundle-2,TopRight,0,0_SH20_.jpg',
  'B076V8N12D': 'https://m.media-amazon.com/images/I/71tFPTPnZSL._AC_SX425_.jpg'
};

const asins = ['B0C43R8SRB','B08L8J6K31','B000FMDIXY','B0002F741Q','B00HVLUR86','B0BQFK6ZFB','B000UJE6UG','B07DPLHDDY','B0DZXYBWYD','B00967UN50','B0002W38JQ','B08L34HBWD','B08GB396C3','B00IHVQ2FQ','B0B12CJC6G','B0CFZYG355','B0BCZFHJ12','B0057PK2TC','B0C5JRTS3Y','B0000AQRST','B07PJ41WPD','B0002F4VIK','B08PBQFQH6','B076V8N12D'];

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
