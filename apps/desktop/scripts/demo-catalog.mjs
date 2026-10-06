// Original fictional music and vector covers, used only by the offline design fixture.
const titles = [
  ['Afterlight', 'Mira Vale', '#123c46', '#6ba6a8', '#efb783'],
  ['Saltwater Lines', 'Low Tide Society', '#173340', '#4a778a', '#d6b78a'],
  ['Glasshouse', 'North Arcade', '#252b32', '#678077', '#d29c80'],
  ['Blue Hour', 'Rowan Ellis', '#192c46', '#4b7592', '#beccce'],
  ['Soft Signal', 'Juniper Lane', '#243c35', '#769981', '#e6c5a5'],
  ['Long Way Home', 'Wren Atlas', '#443534', '#ba8b75', '#b7cbc2'],
  ['Warm Current', 'Harbor Lights', '#203c3a', '#6a9c91', '#e7ab70'],
  ['Paper Satellites', 'Aster Field', '#333b44', '#8c9baa', '#dfc39e'],
  ['Slow Orbit', 'Sora Reed', '#202e38', '#587787', '#d2a982'],
  ['Golden Static', 'Cedar & Finch', '#47382b', '#c29355', '#d9d8bf'],
  ['Tidal Memory', 'Ellis Cove', '#1c3c41', '#568c92', '#c8b09a'],
  ['Open Windows', 'Lumen Park', '#303d39', '#8eab92', '#d9b094']
];
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const covers = titles.map(([title, artist, dark, mid, light], i) => {
  const geometry = [
    `<circle cx="470" cy="174" r="92" fill="${light}"/><path d="M-30 438Q136 272 312 385T690 330V640H-30Z" fill="${mid}"/><path d="M-30 487Q186 359 356 461T690 427V640H-30Z" fill="${dark}" opacity=".76"/>`,
    `<g fill="none" stroke="${light}" stroke-width="2" opacity=".6">${Array.from({length:12},(_,n)=>`<path d="M-80 ${155+n*22}C152 ${40+n*26} 315 ${390+n*12} 710 ${178+n*21}"/>`).join('')}</g><circle cx="488" cy="126" r="28" fill="${light}"/>`,
    `<g transform="translate(108 64) rotate(-17 224 224)"><rect x="0" y="44" width="192" height="302" rx="96" fill="${light}" opacity=".86"/><rect x="210" y="44" width="132" height="302" rx="66" fill="${mid}"/><path d="M84 44V346M276 44V346" stroke="${dark}" stroke-width="2" opacity=".5"/></g>`,
    `<circle cx="322" cy="244" r="154" fill="${mid}"/><circle cx="350" cy="220" r="120" fill="${dark}"/><g stroke="${light}" opacity=".6" fill="none"><ellipse cx="322" cy="244" rx="222" ry="64" transform="rotate(-22 322 244)"/><ellipse cx="322" cy="244" rx="244" ry="88" transform="rotate(-22 322 244)"/></g>`
  ][i%4];
  return 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><defs><linearGradient id="base" x2="1" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${mid}"/></linearGradient><linearGradient id="shade" x2="0" y2="1"><stop stop-color="${dark}" stop-opacity="0"/><stop offset="1" stop-color="${dark}" stop-opacity=".94"/></linearGradient></defs><rect width="640" height="640" fill="url(#base)"/>${geometry}<rect y="375" width="640" height="265" fill="url(#shade)"/><text x="42" y="501" font-family="Arial,sans-serif" font-size="41" fill="#f5f1e7" letter-spacing="-1">${escape(title)}</text><text x="44" y="543" font-family="Arial,sans-serif" font-size="19" fill="#e1e3dc" letter-spacing="2">${escape(artist.toUpperCase())}</text><path d="M44 575H116" stroke="#f5f1e7" opacity=".45"/><text x="548" y="578" font-family="Arial,sans-serif" font-size="13" fill="#e1e3dc">${String(i+1).padStart(2,'0')}</text></svg>`);
});
export function createDemoTrack(id, provider='spotify', prefix='Fixture') {
  const ordinal = Number(String(id).match(/\d+$/)?.[0] ?? 0);
  const index = ordinal % titles.length;
  const [title, artist] = titles[index];
  return { id:`${provider}:${id}`, provider, providerTrackId:String(id), title:prefix==='Fixture' ? title : `${title} · ${prefix}`, creators:[artist], artworkUrl:covers[index], album:'Preview Studies', durationMs:172000+index*7000, explicit:false, playable:true };
}
