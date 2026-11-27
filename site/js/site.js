/* MapForZZ7Z · 介绍页交互
   1) 导航滚动态 + 顶部进度线
   2) IntersectionObserver 分批入场（同级元素依次延迟）
   3) 数字滚动
   4) 主视觉视差
   全部动效都尊重 prefers-reduced-motion。 */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  var items = [].slice.call(document.querySelectorAll('.reveal'));
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    // 同组元素按出现顺序错开，避免整块一起弹出来
    var groups = new Map();
    items.forEach(function (el) {
      var parent = el.parentNode;
      var i = groups.get(parent) || 0;
      groups.set(parent, i + 1);
      // 只让同一容器里的前 6 个错开，后面的直接跟上
      el.style.setProperty('--d', (Math.min(i, 6) * 90) + 'ms');
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
    if (!('IntersectionObserver' in window)) {
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
})();
