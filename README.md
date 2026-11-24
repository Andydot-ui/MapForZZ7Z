# MapForZZ7Z

2D 正射影像地图 + 三维模型 + 点云，Apple Maps 风格界面。
站点由 **Cloudflare Pages** 托管（Direct Upload），不再使用 GitHub Pages。

## 页面

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 影像地图 | `/index.html` | MapLibre GL JS + XYZ WebP 瓦片（z16–z21） |
| 三维场景 | `/3d.html` | Three.js 渲染 GLB（Draco）+ 八叉树 LOD 点云 |

## 数据

| 原始数据 | 大小 | 处理结果 |
| --- | --- | --- |
| `输出.tif`（GeoTIFF, EPSG:32649, 11319×11830, 0.05 m） | 351 MB | 2 020 张 WebP 瓦片，21 MB；另生成 2 560 px 地面贴图，1.9 MB |
| `-textured_model.glb`（glTF 2.0 + Draco + CESIUM_RTC） | 143 MB | 贴图重压缩为 1 024 px，**9.8 MB**（308.5 K 三角面） |
| `-georeferenced_model.laz`（LAS 1.2 PDRF 3, 5 502 820 点） | 29 MB | 八叉树 LOD 407 节点，49.5 MB |

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
python tools/build_tiles.py       # GeoTIFF -> WebP 瓦片
python tools/build_glb.py         # GLB 贴图降采样
python tools/build_pointcloud.py  # LAZ -> 八叉树 LOD
python tools/build_ground.py      # GeoTIFF -> 3D 地面贴图
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
  models/            GLB 与地面贴图
  pointcloud/        octree.json + 节点 .bin
tools/               构建与部署脚本（不参与部署）
```

## 实现要点

- **瓦片**：GeoTIFF 重投影到 EPSG:3857，按 0.05 m/px 切片，WebP q82。
- **点云**：八叉树 LOD，节点内坐标量化为 uint16（9 字节/点），
  着色器里用 `uMin`/`uSpan` 还原，按屏幕误差 2 px + 260 万点预算流式加载。
- **渐进加载**：点云元数据一到就撤掉载入遮罩，模型在后台继续下载。
- **界面**：Apple Maps 风格玻璃面板；窄屏（≤720px）图层收进「图层」胶囊按钮。
