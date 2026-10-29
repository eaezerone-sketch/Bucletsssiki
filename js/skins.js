(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Satellite color skins, unlocked by best score.
  var list = [
    { id: 'comet', name: { ru: 'Комета', en: 'Comet' }, color: '#7df9ff', trail: '#7df9ff', unlock: 0 },
    { id: 'rose', name: { ru: 'Роза', en: 'Rose' }, color: '#ff5fd2', trail: '#ff5fd2', unlock: 60 },
    { id: 'sun', name: { ru: 'Солнце', en: 'Sun' }, color: '#ffd86b', trail: '#ffd86b', unlock: 150 },
    { id: 'mint', name: { ru: 'Мята', en: 'Mint' }, color: '#7dffb0', trail: '#7dffb0', unlock: 300 },
    { id: 'amethyst', name: { ru: 'Аметист', en: 'Amethyst' }, color: '#b58cff', trail: '#b58cff', unlock: 600 },
    { id: 'ghost', name: { ru: 'Призрак', en: 'Ghost' }, color: '#eef2ff', trail: '#eef2ff', unlock: 1000 }
  ];

  function store() {
    return ORB.Storage;
  }

  function findById(id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function isUnlocked(skin, best) {
    return !!skin && (best || 0) >= skin.unlock;
  }

  function currentId() {
    try {
      var id = store().get('skin', list[0].id);
      return findById(id) ? id : list[0].id;
    } catch (e) {
      return list[0].id;
    }
  }

  function current() {
    var skin = findById(currentId()) || list[0];
    var best = 0;
    try { best = store().getBest(); } catch (e) { best = 0; }
    return isUnlocked(skin, best) ? skin : list[0];
  }

  function select(id) {
    var skin = findById(id);
    var best = 0;
    try { best = store().getBest(); } catch (e) { best = 0; }
    if (!skin || !isUnlocked(skin, best)) return false;
    try { store().set('skin', id); } catch (e) { /* storage unavailable */ }
    return true;
  }

  function name(skin) {
    var lang = ORB.I18N && ORB.I18N.lang;
    if (lang !== 'ru' && lang !== 'en') {
      lang = ((navigator.language || '').indexOf('ru') === 0) ? 'ru' : 'en';
    }
    return skin.name[lang] || skin.name.en;
  }

  ORB.Skins = {
    list: list,
    isUnlocked: isUnlocked,
    currentId: currentId,
    current: current,
    select: select,
    name: name
  };
})();
