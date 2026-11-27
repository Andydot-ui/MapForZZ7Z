/* MapForZZ7Z · 介绍页交互
   1) 导航滚动态 + 顶部进度线
   2) IntersectionObserver 分批入场（同级元素依次延迟）
   3) 数字滚动
   4) 主视觉视差
   5) 新增：标题逐词入场 / 卡片 3D 微倾斜 / 时间线描线 / 对比条增长
   全部动效都尊重 prefers-reduced-motion。 */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var HAS_IO = 'IntersectionObserver' in window;

  /* ---------- 导航 + 进度线 ---------- */
  var nav = document.getElementById('gn');
  var bar = document.getElementById('progress');

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (nav) nav.classList.toggle('scrolled', y > 8);

    if (bar) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      bar.style.transform = 'scaleX(' + p + ')';
    }
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      onScroll();
      ticking = false;
    });
  }, { passive: true });
  onScroll();

  /* ---------- 入场动画 ---------- */
  // .reveal / .tilt 走通用的渐入；.tl-item / .bar-row 有各自的时序
  var items = [].slice.call(document.querySelectorAll('.reveal, .tilt, .tl-item, .bar-row'));
  if (reduce || !HAS_IO) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    // 同组元素按出现顺序错开，避免整块一起弹出来
    var groups = new Map();
    items.forEach(function (el) {
      var parent = el.parentNode;
      var i = groups.get(parent) || 0;
      groups.set(parent, i + 1);
      var step = Math.min(i, 8);
      if (el.classList.contains('tl-item') || el.classList.contains('bar-row')) {
        // 时间线步骤与对比条用 --td 串行推进
        el.style.setProperty('--td', (step * 150) + 'ms');
        el.style.setProperty('--d', (step * 150) + 'ms');
        // 同一张卡片里的两根条先后长出来
        var fills = el.querySelectorAll('.bar-fill');
        Array.prototype.forEach.call(fills, function (f, k) {
          f.style.setProperty('--d', (k * 140) + 'ms');
        });
      } else {
        // 只让同一容器里的前 6 个错开，后面的直接跟上
        el.style.setProperty('--d', (Math.min(i, 6) * 90) + 'ms');
      }
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 数字滚动 ---------- */
  // 元素上写 data-count 目标值，data-dec 小数位，data-suffix 后缀
  var nums = [].slice.call(document.querySelectorAll('[data-count]'));

  function fmt(v, dec) {
    return dec > 0
      ? v.toFixed(dec)
      : Math.round(v).toLocaleString('en-US');
  }

  function runCount(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    if (reduce || !target) {
      el.textContent = fmt(target, dec);
      return;
    }
    var dur = 1500;
    var t0 = performance.now();
    function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      // easeOutExpo，收尾很稳
      var e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = fmt(target * e, dec);
      if (p < 1) window.requestAnimationFrame(step);
      else el.textContent = fmt(target, dec);
    }
    window.requestAnimationFrame(step);
  }

  if (nums.length) {
    if (!HAS_IO) {
      nums.forEach(runCount);
    } else {
      var nio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          runCount(e.target);
          nio.unobserve(e.target);
        });
      }, { threshold: 0.5 });
      nums.forEach(function (el) {
        el.textContent = fmt(0, parseInt(el.getAttribute('data-dec') || '0', 10));
        nio.observe(el);
      });
    }
  }

  /* ---------- 标题逐词入场 ---------- */
  // data-split 的标题按「词」切成 span，用 --wd 错峰
  // 中文按标点与固定字数断词，避免逐字块在行首被拆坏
  var splits = [].slice.call(document.querySelectorAll('[data-split]'));
  if (splits.length) {
    var PUNCT = '，。、；：？！“”‘’（）《》〈〉【】…—·,.;:?!()[]';
    splits.forEach(function (el) {
      var frag = document.createDocumentFragment();
      var gi = 0;

      function addGroup(txt) {
        if (!txt) return;
        var s = document.createElement('span');
        s.className = 'w';
        s.style.setProperty('--wd', (gi * 70) + 'ms');
        s.textContent = txt;
        frag.appendChild(s);
        gi++;
      }
      Array.prototype.forEach.call(el.childNodes, function (node) {
        if (node.nodeType === 1) {
          frag.appendChild(node.cloneNode(true));
          return;
        }
        if (node.nodeType !== 3) return;
        var buf = '';
        var punct = '';
        Array.prototype.slice.call(node.nodeValue).forEach(function (ch) {
          // 标点单独跟在前一个词后面，随即结算
          if (PUNCT.indexOf(ch) >= 0) {
            if (!buf) return;
            addGroup(buf + ch);
            buf = '';
            return;
          }
          buf += ch;
          // 每两个字切一组，短句读起来更稳
          if (buf.replace(/\s/g, '').length >= 2) {
            addGroup(buf);
            buf = '';
          }
        });
        if (buf) addGroup(buf);
      });

      el.innerHTML = '';
      el.appendChild(frag);
      el.classList.add('split-head');
    });

    if (reduce || !HAS_IO) {
      splits.forEach(function (el) { el.classList.add('in'); });
    } else {
      var sio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          // 先让词隐藏，再下一帧开始逐词亮起
          e.target.classList.add('split-ready');
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
              e.target.classList.add('in');
            });
          });
          sio.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -10% 0px', threshold: 0.2 });
      splits.forEach(function (el) { sio.observe(el); });
    }
  }

  /* ---------- 卡片 3D 微倾斜 ---------- */
  // mousemove 只更新 CSS 变量，变换本身交给合成器
  var tilts = [].slice.call(document.querySelectorAll('.tilt'));
  if (!reduce) {
    tilts.forEach(function (card) {
      var raf = null;
      card.addEventListener('mousemove', function (e) {
        if (raf) return;
        raf = window.requestAnimationFrame(function () {
          var r = card.getBoundingClientRect();
          if (!r.width || !r.height) { raf = null; return; }
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          card.style.setProperty('--ry', (px * 8).toFixed(2) + 'deg');
          card.style.setProperty('--rx', (-py * 8).toFixed(2) + 'deg');
          raf = null;
        });
      });
      card.addEventListener('mouseleave', function () {
        card.style.setProperty('--ry', '0deg');
        card.style.setProperty('--rx', '0deg');
      });
    });
  }

  /* ---------- 主视觉视差 ---------- */
  var shot = document.querySelector('.hero-shot');
  if (shot && !reduce) {
    var raf = null;
    window.addEventListener('scroll', function () {
      if (raf) return;
      raf = window.requestAnimationFrame(function () {
        var y = window.scrollY || window.pageYOffset;
        if (y < 900) {
          shot.style.transform = 'translateY(' + (y * 0.06).toFixed(1) + 'px)';
        }
        raf = null;
      });
    }, { passive: true });
  }

  /* ---------- 接管入场动画 ---------- */
  // 内联脚本已经标了 .js，这里再确认一次，并告诉它脚本已就位
  var root = document.documentElement;
  root.classList.add('js');
  root.dataset.animReady = '1';
})();
