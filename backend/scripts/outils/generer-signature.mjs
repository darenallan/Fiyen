// Produit le PNG de signature qui sert d'échantillon aux tests.
//
//   node backend/scripts/outils/generer-signature.mjs
//
// Pourquoi un générateur plutôt qu'une constante recopiée : un PNG écrit à la
// main passe la comparaison d'octets d'un test d'API — qui ne fait que
// comparer ce qui entre et ce qui sort — et se fait pourtant refuser par le
// navigateur si un seul CRC est faux. C'est arrivé, et seul un rendu réel l'a
// montré. Ici les CRC sont calculés, donc justes par construction.

import zlib from 'node:zlib';

const LARGEUR = 140;
const HAUTEUR = 44;

/** Table CRC-32 du format PNG (polynôme 0xEDB88320). */
const TABLE = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const octet of buf) c = TABLE[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(data.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, controle]);
}

// RGBA, fond transparent : une signature s'imprime sur le papier, pas sur un
// rectangle blanc posé au milieu du reçu.
const pixels = Buffer.alloc(LARGEUR * HAUTEUR * 4, 0);
const poser = (x, y) => {
  if (x < 0 || y < 0 || x >= LARGEUR || y >= HAUTEUR) return;
  const o = (y * LARGEUR + x) * 4;
  pixels[o] = 0x16;
  pixels[o + 1] = 0x33;
  pixels[o + 2] = 0x2a;
  pixels[o + 3] = 255;
};

for (let x = 8; x < LARGEUR - 8; x++) {
  const y = Math.round(HAUTEUR / 2 + Math.sin(x / 7) * 9 - x / 22);
  for (let e = -1; e <= 1; e++) poser(x, y + e);
}

// Chaque ligne est précédée de son octet de filtre — 0, « aucun ».
const brut = Buffer.alloc(HAUTEUR * (1 + LARGEUR * 4));
for (let y = 0; y < HAUTEUR; y++) {
  const debut = y * (1 + LARGEUR * 4);
  brut[debut] = 0;
  pixels.copy(brut, debut + 1, y * LARGEUR * 4, (y + 1) * LARGEUR * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(LARGEUR, 0);
ihdr.writeUInt32BE(HAUTEUR, 4);
ihdr[8] = 8; // 8 bits par canal
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(brut)),
  chunk('IEND', Buffer.alloc(0)),
]);

console.log(png.toString('base64'));
