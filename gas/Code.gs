// 廣論時時聽-範圍搜尋：輸入原文的起始文字與結尾文字，找出播放範圍、總時間與播放連結
// 資料在 data.gs（由 make-gas-data.js 產生）

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('廣論時時聽-範圍搜尋')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

var CH = 0, TIME = 1, END_CH = 2, END_TIME = 3, TXT = 4;

// 音檔類別，順序與名稱照連結產生器的下拉選單（Index.html 的 #tch 要跟這裡一致）；
// title 照播放頁顯示的名稱；目前只有 gl1 有資料
var TEACHINGS = [
  { key: 'gl1', name: '廣論-南普陀版', title: '《廣論》南普陀版', enabled: true },
  { key: 'ggl2', name: '全球廣論-II', title: '《廣海明月》', enabled: false },
  { key: 'gl2', name: '廣論-鳳山寺版', title: '《廣論》鳳山寺版', enabled: false },
  { key: 'nv1', name: '南山律在家備覽', title: '《南山律在家備覽》', enabled: false },
];

function plainText(s) {
  return s.replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '');
}

// 全部粗體字移除標點後接成一個長字串，記下每一段的起點，才能找到跨兩段的文字。
// 第一次用到時才建立：Apps Script 各檔案的載入順序不保證 data.gs 在前
var BOOK = null;

function getBook() {
  if (BOOK) return BOOK;
  var text = '';
  var starts = [];
  DATA.sections.forEach(function (s) {
    starts.push(text.length);
    text += plainText(s[TXT]);
  });
  BOOK = { text: text, starts: starts };
  return BOOK;
}

function idAt(pos) {
  var starts = getBook().starts;
  var lo = 0;
  var hi = starts.length - 1;
  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function findAll(q) {
  var text = getBook().text;
  var out = [];
  for (var at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + 1)) {
    out.push({ at: at, id: idAt(at), endId: idAt(at + q.length - 1) });
  }
  return out;
}

function toSeconds(t) {
  var p = t.split(':');
  return parseInt(p[0], 10) * 60 + parseFloat(p[1]);
}

function formatDuration(sec) {
  var total = Math.round(sec);
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  return (h ? h + ' 小時 ' : '') + m + ' 分 ' + (s < 10 ? '0' : '') + s + ' 秒';
}

// 音檔順序：001a=0、001b=1、002a=2 ……
function chapterOrder(ch) {
  return (parseInt(ch, 10) - 1) * 2 + (/b$/.test(ch) ? 1 : 0);
}

function chapterName(order) {
  var n = String(Math.floor(order / 2) + 1);
  while (n.length < 3) n = '0' + n;
  return n + (order % 2 ? 'b' : 'a');
}

// 播放連結裡的音檔 ID：098a → 98a
function linkId(order) {
  return chapterName(order).replace(/^0+/, '');
}

// 兩個時間點之間的秒數，時間點可以在不同卷
function secondsBetween(fromCh, fromTime, toCh, toTime) {
  var from = chapterOrder(fromCh);
  var to = chapterOrder(toCh);
  var startSec = toSeconds(fromTime);
  var endSec = toSeconds(toTime);
  if (from === to) return endSec - startSec;
  var sum = DATA.durations[chapterName(from)] - startSec;
  for (var o = from + 1; o < to; o++) sum += DATA.durations[chapterName(o)];
  return sum + endSec;
}

function totalSeconds(s, e) {
  return secondsBetween(s[CH], s[TIME], e[END_CH], e[END_TIME]);
}

// 把 sections[startId..endId] 切成 parts 份：每一份的目標長度 = 剩下的時間 ÷ 剩下的份數，
// 在粗體字 section 的起點裡找最接近目標的點當切點
function split(startId, endId, parts) {
  var count = endId - startId + 1;
  if (parts > count) throw new Error('範圍裡只有 ' + count + ' 段粗體字，最多切成 ' + count + ' 份');
  var first = DATA.sections[startId];
  var elapsed = function (id) {
    return secondsBetween(first[CH], first[TIME], DATA.sections[id][CH], DATA.sections[id][TIME]);
  };
  var total = totalSeconds(first, DATA.sections[endId]);
  var result = [];
  var from = startId;
  for (var left = parts; left > 1; left--) {
    var target = elapsed(from) + (total - elapsed(from)) / left;
    // 切點是下一份的第一段：至少留一段給這一份，也要留夠段數給後面每一份
    var best = from + 1;
    for (var id = from + 1; id <= endId - (left - 2); id++) {
      if (Math.abs(elapsed(id) - target) < Math.abs(elapsed(best) - target)) best = id;
    }
    result.push([from, best - 1]);
    from = best;
  }
  result.push([from, endId]);
  return result;
}

// 播放連結，格式照連結產生器：同一個音檔 af1/st1/et1；兩個音檔 af1/st1/af2/et2；三個音檔 af1/st1/af2/af3/et3。
// 播放頁一個連結最多 3 個音檔，超過時依序拆成多個連結；et = -1 表示播到音檔結尾。
function makeLinks(fromCh, fromTime, toCh, toTime) {
  var from = chapterOrder(fromCh);
  var to = chapterOrder(toCh);
  var endSec = toSeconds(toTime);
  var links = [];
  for (var first = from; first <= to; first += 3) {
    var last = Math.min(first + 2, to);
    var q = '?&tch=gl1';
    for (var o = first; o <= last; o++) {
      var n = o - first + 1;
      q += '&af' + n + '=' + linkId(o);
      if (o === first) q += '&st' + n + '=' + (o === from ? Math.round(toSeconds(fromTime)) : 0);
      if (o === last) {
        var atFileEnd = o !== to || Math.abs(endSec - DATA.durations[chapterName(o)]) < 0.5;
        q += '&et' + n + '=' + (atFileEnd ? -1 : Math.round(endSec));
      }
    }
    links.push('https://lamrim.xyz/player2/' + q);
  }
  return links;
}

function describe(teaching, label, s, e) {
  return {
    label: label,
    startChapter: s[CH].toUpperCase(),
    startTime: s[TIME],
    startText: s[TXT].replace(/\n/g, ' '),
    endChapter: e[END_CH].toUpperCase(),
    endTime: e[END_TIME],
    endText: e[TXT].replace(/\n/g, ' '),
    total: formatDuration(totalSeconds(s, e)),
    title: teaching.title + ' [' + linkId(chapterOrder(s[CH])).toUpperCase() + '] ' + s[TIME] + '~[' + linkId(chapterOrder(e[END_CH])).toUpperCase() + '] ' + e[END_TIME],
    links: makeLinks(s[CH], s[TIME], e[END_CH], e[END_TIME]),
  };
}

// 網頁呼叫：回傳 [{ whole, pieces }]，起始文字出現多次時每一次一筆
function findRange(tch, startRaw, endRaw, parts) {
  var teaching = TEACHINGS.filter(function (t) { return t.key === tch; })[0];
  if (!teaching) throw new Error('不認得的音檔類別：' + tch);
  if (!teaching.enabled) throw new Error(teaching.name + ' 目前還不能搜尋');
  parts = Number(parts) || 1;
  if (parts < 1 || Math.floor(parts) !== parts) throw new Error('份數要填 1 以上的整數');
  var startQ = plainText(String(startRaw || ''));
  var endQ = plainText(String(endRaw || ''));
  if (!startQ || !endQ) throw new Error('起始文字與結尾文字都要有字');

  var startHits = findAll(startQ);
  if (!startHits.length) throw new Error('找不到起始文字：' + startRaw);
  var endHits = findAll(endQ);
  if (!endHits.length) throw new Error('找不到結尾文字：' + endRaw);

  var ranges = [];
  startHits.forEach(function (sh) {
    var eh = endHits.filter(function (h) { return h.at >= sh.at; })[0];
    if (eh) ranges.push({ startId: sh.id, endId: eh.endId });
  });
  if (!ranges.length) throw new Error('結尾文字都在起始文字之前');

  return ranges.map(function (r) {
    var pieces = parts === 1 ? [] : split(r.startId, r.endId, parts);
    return {
      whole: describe(teaching, '全', DATA.sections[r.startId], DATA.sections[r.endId]),
      pieces: pieces.map(function (p, i) {
        return describe(teaching, String(i + 1), DATA.sections[p[0]], DATA.sections[p[1]]);
      }),
    };
  });
}
