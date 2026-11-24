# MapForZZ7Z

2D 正射影像地图 + 三维模型 + 点云，Apple Maps 风格界面。
站点由 **Cloudflare Pages** 托管（Direct Upload），不再使用 GitHub Pages。

## 页面

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 影像地图 | `/index.html` | MapLibre GL JS + XYZ WebP 瓦片（z15–z21） |
| 三维场景 | `/3d.html` | Three.js 渲染 GLB（Draco）+ 八叉树 LOD 点云 |

## 数据

| 原始数据 | 大小 | 处理结果 |
| --- | --- | --- |
| `输出.tif`（GeoTIFF, EPSG:32649, 11319×11830, 0.05 m） | 351 MB | 2 374 张 WebP 瓦片，21.9 MB |
| `-textured_model.glb`（glTF 2.0 + Draco + CESIUM_RTC） | 143 MB | 贴图重压缩为 1 024 px，**9.8 MB**（308.5 K 三角面） |
| `-georeferenced_model.laz`（LAS 1.2 PDRF 3, 5 502 820 点） | 29 MB | 八叉树 LOD 407 节点、2.95 M 点，**26.6 MB** |

单文件均小于 Cloudflare Pages 的 25 MiB 限制。

## 坐标

影像位于郑州，约 113.6625°E / 34.8323°N（UTM 49N）。
模型与点云共用 `CESIUM_RTC` 中心 `(743487, 3857689, 0)` 作为局部原点，
场景为 Z-up：`X = 东`、`Y = 北`、`Z = 高程`。

## 本地预览

```bash
node tools/serve.mjs web 8787
# http://127.0.0.1:8787/
```

## 重新生成资源

```bash
python tools/build_tiles.py       # GeoTIFF -> WebP 瓦片（ONLY_Z=15 只重建某级）
python tools/build_ring_tiles.py  # 影像外一圈全透明瓦片，避免 404
python tools/build_glb.py         # GLB 贴图降采样
python tools/build_pointcloud.py  # LAZ -> 八叉树 LOD
```

## 部署

```bash
export CLOUDFLARE_ACCOUNT_ID=...   # PowerShell: $env:CLOUDFLARE_ACCOUNT_ID='...'
export CLOUDFLARE_API_TOKEN=...
node tools/deploy.mjs              # Cloudflare Pages Direct Upload
```

线上地址：<https://mapforzz7z.pages.dev/>（地图）与 <https://mapforzz7z.pages.dev/3d>（三维）。

## 目录

```
web/                 站点根目录（Pages 上传内容）
  index.html         地图页
  3d.html            三维页
  _headers           缓存策略（瓦片/点云节点 immutable）
  favicon.svg        站点图标
  css/ js/           样式与逻辑
  vendor/            MapLibre GL JS、Three.js、Draco 解码器
  tiles/             XYZ WebP 瓦片
  models/            GLB 模型
  pointcloud/        octree.json + 节点 .bin
tools/               构建与部署脚本（不参与部署）
```

## 实现要点

- **瓦片**：GeoTIFF 重投影到 EPSG:3857，按瓦片网格对齐切片（相邻瓦片无透明接缝），WebP q82。
- **初始视图**：按墨卡托跨度算出「整幅影像刚好装进视口」的缩放级别（contain），
  四周留底色内边距，整幅图居中完整显示；用户一旦自己拖动或缩放就不再自动重设。
- **深色模式**：跟随系统 `prefers-color-scheme`，玻璃面板、底色、控件、比例尺同步切换，
  切换时地图底色与页面主题实时联动。
- **点云**：八叉树 LOD，节点内坐标量化为 uint16（9 字节/点），
  着色器里用 `uMin`/`uSpan` 还原，按屏幕误差 2 px + 260 万点预算流式加载；
  各级节点按网格抽稀，叶子层同样抽稀（体积减半、观感不变）。
- **渐进加载**：点云元数据一到就撤掉载入遮罩，模型在后台继续下载。
- **三维场景**：只保留模型、点云与地面网格，不铺正射底图、不铺深色大平面，
  物体直接浮在背景渐变上；罗盘指针取世界正北在屏幕上的投影，连续转动不会突跳。
- **界面**：Apple Maps 风格玻璃面板；窄屏（≤720px）图层收进「图层」胶囊按钮。
