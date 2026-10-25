'use strict';
/**
 * Minimal S-expression reader used by the build tools and the tests to check
 * the KiCad files this repo generates. Not a full KiCad parser.
 */

function tokenize(text) {
  return text.match(/\(|\)|"(?:[^"\\]|\\.)*"|[^\s()]+/g) || [];
}

function parseSexpr(text) {
  const tokens = tokenize(text);
  let pos = 0;
  function read() {
    const t = tokens[pos];
    if (t === undefined) {
      throw new Error('unexpected end of input');
    }
    if (t === '(') {
      pos += 1;
      const list = [];
      while (tokens[pos] !== ')') {
        if (tokens[pos] === undefined) {
          throw new Error('unbalanced parentheses');
        }
        list.push(read());
      }
      pos += 1;
      return list;
    }
    if (t === ')') {
      throw new Error('unexpected closing parenthesis');
    }
    pos += 1;
    return t.charAt(0) === '"' ? JSON.parse(t) : t;
  }
  const root = read();
  if (pos !== tokens.length) {
    throw new Error('trailing content after the root expression');
  }
  return root;
}

function children(node, name) {
  return node.filter((x) => Array.isArray(x) && x[0] === name);
}

function child(node, name) {
  return children(node, name)[0];
}

module.exports = { parseSexpr, children, child };
