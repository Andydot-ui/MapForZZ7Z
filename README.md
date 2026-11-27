# MapForZZ7Z

2D 正射影像地图 + 三维模型 + 点云，Apple Maps 风格界面。

应用本体由 **Cloudflare Pages** 托管（Direct Upload）；
`site/` 下的产品介绍页由 **GitHub Pages** 托管（`gh-pages` 分支），两者互不干扰。

## 页面

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 影像地图 | `/map` | MapLibre GL JS + XYZ WebP 瓦片（z15–z21） |
| 三维场景 | `/3d` | Three.js 渲染 GLB（Draco）+ 八叉树 LOD 点云 |
| 产品介绍 | 见下 | Apple 产品页风格的单页介绍，深浅色自动切换 |

`/` 会落到地图页；`/index.html`、`/3d.html` 重定向到新路径（见 `web/_redirects`）。

## 数据

| 原始数据 | 大小 | 处理结果 |
| --- | --- | --- |
| `输出.tif`（GeoTIFF, EPSG:32649, 11319×11830, 0.05 m） | 351 MB | 2 374 张 WebP 瓦片，21.9 MB |
| `三维.glb`（glTF 2.0 + Draco + CESIUM_RTC） | 366 MB | 79 张贴图压到 1 024 px，**19.3 MB**（329.1 K 三角面） |
| `三维.laz`（LAS 1.4 PDRF 7, 34 316 040 点） | 165 MB | 八叉树 LOD 214 节点、2.85 M 点，**25.7 MB** |

单文件均小于 Cloudflare Pages 的 25 MiB 限制（点云最大单节点 0.51 MB）。

## 坐标

影像位于郑州，约 113.6625°E / 34.8323°N（UTM 49N）。
模型与点云共用 `CESIUM_RTC` 中心 `(743469, 3857681, 0)` 作为局部原点，
场景为 Z-up：`X = 东`、`Y = 北`、`Z = 高程`。

## 本地预览

```bash
node tools/serve.mjs web 8787
# http://127.0.0.1:8787/map  与  http://127.0.0.1:8787/3d
```

`tools/serve.mjs` 复刻了 `web/_redirects` 的路由表，本地即可访问 `/map`、`/3d`。

## 重新生成资源

```bash
python tools/build_tiles.py       # GeoTIFF -> WebP 瓦片（ONLY_Z=15 只重建某级）
python tools/build_ring_tiles.py  # 影像外一圈全透明瓦片，避免 404
python tools/build_glb.py         # GLB 贴图降采样（几何不动）
python tools/build_pointcloud.py  # LAZ -> 八叉树 LOD
```

换数据时注意：`build_pointcloud.py` 的 `CENTER` 必须与 GLB 的 `CESIUM_RTC`
中心一致，`GRID`/`MINX`/`MINY`/`MINZ` 的根立方体必须包住全部点，否则模型与点云会错位。

## 部署

```bash
export CLOUDFLARE_ACCOUNT_ID=...   # PowerShell: $env:CLOUDFLARE_ACCOUNT_ID='...'
export CLOUDFLARE_API_TOKEN=...
node tools/deploy.mjs              # Cloudflare Pages Direct Upload
```

线上地址：<https://andydot.dpdns.org/map>（地图）与 <https://andydot.dpdns.org/3d>（三维）。
`https://mapforzz7z.pages.dev/map`、`/3d` 同样可用。

介绍页单独走 GitHub Pages（`gh-pages` 分支，内容来自 `site/`）：
<https://andydot-ui.github.io/MapForZZ7Z/>

```bash
node tools/deploy-ghpages.cjs       # site/ -> gh-pages（走 GitHub API）
```

本机直连 `github.com:443` 会被重置，脚本改用 REST API 推内容；
`api.github.com` 也偶发超时，脚本内已带重试。改完 `site/` 重跑一次即可。

## 介绍页

`site/` 是一页静态站，不依赖构建工具，直接上传即可：

| 文件 | 说明 |
| --- | --- |
| `index.html` | 单页：概览 / 三层数据 / 地图 / 三维 / 数据 / 双视角 / 坐标系 / 规格 |
| `css/site.css` | 浅色与深色两套 token，`prefers-color-scheme` 自动切换 |
| `js/site.js` | 滚动进度线、渐入、数字滚动、视差（尊重 `prefers-reduced-motion`） |
| `img/*.jpg` | 界面截图、三维主视觉与三张分层图（单张 ≤ 340 KB） |

截图素材由 `tools/site_images.py`（缩放压缩）与 `tools/trim_hero.py`（按内容包围盒裁剪）生成，
三张分层图由 `tools/site_crops.py` 从主视觉居中裁出，抓屏用 `tools/cdp.mjs`（DPR 2）。整站约 2.0 MB。

## 目录

```
web/                 应用站点根目录（Cloudflare Pages 上传内容）
  map.html           地图页
  3d.html            三维页
  _redirects         /map、/3d、/ 路由
  _headers           缓存策略（瓦片/点云节点 immutable）
  favicon.svg        站点图标
  css/ js/           样式与逻辑
  vendor/            MapLibre GL JS、Three.js、Draco 解码器
  tiles/             XYZ WebP 瓦片
  models/            GLB 模型
  pointcloud/        octree.json + 节点 .bin
site/                产品介绍页（GitHub Pages 上传内容）
tools/               构建与部署脚本（不参与部署）
```

所有资源引用都写成根绝对路径（`/tiles/…`、`/models/…`、`/js/…`），
页面才能同时挂在 `/map`、`/3d` 这类无尾斜杠路径下。

## 实现要点

- **瓦片**：GeoTIFF 重投影到 EPSG:3857，按瓦片网格对齐切片（相邻瓦片无透明接缝），WebP q82。
- **初始视图**：按墨卡托跨度算出「整幅影像刚好装进视口」的缩放级别（contain），
  四周留底色内边距，整幅图居中完整显示；用户一旦自己拖动或缩放就不再自动重设。
- **深色模式**：跟随系统 `prefers-color-scheme`，玻璃面板、底色、控件、比例尺同步切换，
  切换时地图底色与页面主题实时联动。
- **点云**：八叉树 LOD，节点内坐标量化为 uint16（9 字节/点），
  着色器里用 `uMin`/`uSpan` 还原，按屏幕误差 2 px + 300 万点预算流式加载；
  各级节点按网格抽稀，叶子层同样抽稀（体积减半、观感不变）。
- **渐进加载**：点云元数据一到就撤掉载入遮罩，模型在后台继续下载。
- **三维场景**：只保留模型、点云与地面网格，不铺正射底图、不铺深色大平面，
  物体直接浮在背景渐变上；罗盘指针取世界正北在屏幕上的投影，连续转动不会突跳。
- **界面**：Apple Maps 风格玻璃面板；窄屏（≤720px）图层收进「图层」胶囊按钮。
