/* markdown.js — 가벼운 Markdown 렌더러 (XSS 방지: 먼저 escape) */
(function () {
  'use strict';
  const AIC = (window.AIC = window.AIC || {});
  const esc = AIC.util.escapeHtml;

  function inline(text) {
    let out = text;
    const codes = [];
    out = out.replace(/`([^`]+)`/g, function (_, code) {
      codes.push(code);
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    // 남은 맨 URL
    out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (_, pre, url) {
      return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    out = out.replace(/\u0000C(\d+)\u0000/g, function (_, idx) {
      return '<code>' + codes[Number(idx)] + '</code>';
    });
    return out;
  }

  function isTableSep(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function render(src) {
    const lines = String(src == null ? '' : src).replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let i = 0;
    let listType = null;
    let para = [];

    function closeList() {
      if (listType) { html.push('</' + listType + '>'); listType = null; }
    }
    function flushPara() {
      if (para.length) {
        html.push('<p>' + inline(para.join(' ')) + '</p>');
        para = [];
      }
    }
    function openList(type) {
      if (listType && listType !== type) closeList();
      if (!listType) { html.push('<' + type + '>'); listType = type; }
    }

    while (i < lines.length) {
      const raw = lines[i];

      // 코드 블록
      if (/^\s*```/.test(raw)) {
        flushPara(); closeList();
        const lang = raw.replace(/^\s*```/, '').trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        html.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' +
          esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 표
      if (raw.indexOf('|') !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushPara(); closeList();
        const head = splitRow(raw);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          rows.push(splitRow(lines[i]));
          i++;
        }
        html.push('<table><thead><tr>' +
          head.map((c) => '<th>' + inline(c) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + head.map((_, ci) => '<td>' + inline(r[ci] == null ? '' : r[ci]) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>');
        continue;
      }

      if (!raw.trim()) { flushPara(); closeList(); i++; continue; }

      const h = raw.match(/^\s{0,3}(#{1,4})\s+(.*)$/);
      if (h) {
        flushPara(); closeList();
        const lv = h[1].length;
        html.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++; continue;
      }

      if (/^\s{0,3}(---+|\*\*\*+|___+)\s*$/.test(raw)) {
        flushPara(); closeList(); html.push('<hr>'); i++; continue;
      }

      if (/^\s{0,3}>\s?/.test(raw)) {
        flushPara(); closeList();
        const buf = [];
        while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        html.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
        continue;
      }

      const ul = raw.match(/^\s{0,3}[-*+]\s+(.*)$/);
      if (ul) {
        flushPara(); openList('ul');
        html.push('<li>' + inline(ul[1]) + '</li>');
        i++; continue;
      }
      const ol = raw.match(/^\s{0,3}\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara(); openList('ol');
        html.push('<li>' + inline(ol[1]) + '</li>');
        i++; continue;
      }

      closeList();
      para.push(raw.trim());
      i++;
    }
    flushPara(); closeList();
    return html.join('');
  }

  AIC.markdown = { render };
})();
