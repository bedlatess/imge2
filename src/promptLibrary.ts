export type PromptTemplate = {
  id: string;
  title: string;
  category: string;
  level: "入门" | "进阶" | "专业";
  tags: string[];
  ratio: string;
  description: string;
  prompt: string;
};

export const promptCategories = [
  "全部",
  "角色设定",
  "海报视觉",
  "产品摄影",
  "UI Mockup",
  "人像摄影",
  "微缩场景",
  "图标与资产",
  "营销创意",
  "手账插画",
];

export const promptTemplates: PromptTemplate[] = [
  {
    id: "character-sheet-adventurer",
    title: "星港修复师设定稿",
    category: "角色设定",
    level: "专业",
    tags: ["三视图", "装备拆解", "游戏概念"],
    ratio: "1536x1024",
    description: "用于游戏、动画、IP 设定的完整角色设计页。",
    prompt:
      "创作一张专业角色设定稿，主角是在轨道星港维修古董飞船的年轻修复师。画面包含正面、侧面、背面三视图，六个表情变化，装备拆解区域，包括磁吸扳手、袖珍焊接器、护目镜、工具腰包。配色为青铜、煤黑与信号橙，背景为干净的浅灰蓝，半写实概念设计风格，线条清晰，布局像官方设定集页面。",
  },
  {
    id: "official-action-figure",
    title: "收藏级手办包装",
    category: "产品摄影",
    level: "进阶",
    tags: ["手办", "包装", "收藏品"],
    ratio: "1024x1536",
    description: "把角色或人物转成商业级玩具包装视觉。",
    prompt:
      "生成一张收藏级角色手办包装图。透明吸塑盒内放置一位精致 3D 手办，旁边陈列三件可替换配件和一个小型底座。外包装采用高级黑与电光蓝配色，有银色压印标题、产品编号、年龄标识和简洁参数表。摄影棚灯光，真实塑料反光，细节锐利，构图像高端潮玩品牌发布图。",
  },
  {
    id: "cinematic-teaser-poster",
    title: "科幻电影预告海报",
    category: "海报视觉",
    level: "专业",
    tags: ["电影海报", "科幻", "标题排版"],
    ratio: "1792x1024",
    description: "适合电影、游戏、活动预告的强叙事视觉。",
    prompt:
      "设计一张 16:9 科幻电影预告海报。一位孤独人物背对镜头站在巨大数据穹顶前，周围悬浮成千上万块蓝色全息屏幕，中心爆发金白色体积光。底部加入宽字距标题 INVENTOR，副标题 DISCOVERY IS JUST THE BEGINNING。深蓝与琥珀色对比，电影级光效，尺度宏大，构图克制，不要出现多余人物。",
  },
  {
    id: "premium-saas-dashboard",
    title: "SaaS 仪表盘 Mockup",
    category: "UI Mockup",
    level: "专业",
    tags: ["Dashboard", "B2B", "界面设计"],
    ratio: "1536x1024",
    description: "生成可用于官网、融资材料、产品展示的界面图。",
    prompt:
      "生成一张高级 B2B SaaS 仪表盘界面 mockup，主题是 AI 图像生产工作台。暗色模式，左侧窄导航，中间是任务队列和画廊网格，右侧是模型参数与成本分析。界面真实可用，有表格、筛选器、状态标签、折线图和小型预览图。使用精细边框、青色与琥珀色点缀、清晰层级，整体像成熟商业软件截图。",
  },
  {
    id: "neon-editorial-portrait",
    title: "便利店霓虹人像",
    category: "人像摄影",
    level: "进阶",
    tags: ["胶片", "夜景", "街头"],
    ratio: "1024x1536",
    description: "偏真实摄影，适合写真、头像、氛围图。",
    prompt:
      "生成一张 35mm 胶片感夜间人像。人物站在便利店玻璃窗旁，室内冷白荧光灯与窗外彩色霓虹混合，脸部有自然皮肤纹理，背景玻璃有真实反射。中近景构图，高反差但不过曝，带细腻颗粒、轻微暗角、街头编辑写真气质。不要水印，不要文字。",
  },
  {
    id: "miniature-ai-studio",
    title: "微缩 AI 工作室",
    category: "微缩场景",
    level: "进阶",
    tags: ["微缩", "建筑", "空间"],
    ratio: "1024x1024",
    description: "把真实空间转成精致模型场景。",
    prompt:
      "创作一个放在桌面上的微缩商业空间模型，主题是一家未来感 AI 影像工作室。透明玻璃外墙、发光招牌、小型人偶、展示屏、接待台和墙面作品陈列都清楚可见。使用等距视角，浅景深，真实树脂模型质感，边缘精致，灯光温暖，像高端建筑模型摄影。",
  },
  {
    id: "fluffy-3d-icon",
    title: "毛绒 3D 图标",
    category: "图标与资产",
    level: "入门",
    tags: ["图标", "3D", "品牌资产"],
    ratio: "1024x1024",
    description: "适合 App 图标、功能入口、品牌贴纸。",
    prompt:
      "生成一个毛绒质感的 3D 图标，主体是一枚发光的魔法相机镜头。图标需要柔软绒毛边缘、圆润体积、细微纤维、青蓝和玫红渐变，放在干净深色背景中。中心镜片有微弱星光反射，整体可爱但专业，适合作为 AI 生图工具的功能图标。",
  },
  {
    id: "ad-campaign-poster",
    title: "浏览器游戏广告创意",
    category: "营销创意",
    level: "进阶",
    tags: ["广告", "转化", "社媒素材"],
    ratio: "1024x1024",
    description: "用于活动、课程、游戏、工具的高转化广告图。",
    prompt:
      "创作一张 1:1 专业广告海报，用于推广一款赛博朋克风格浏览器游戏。画面中央是发光的主角装备与奖励宝箱，周围有速度线、粒子和悬浮 UI。加入清晰主标题、限时活动标签、三条卖点信息和醒目的行动按钮。排版有强视觉层级，字体清晰，颜色大胆但不廉价，像资深广告设计师完成的投放素材。",
  },
  {
    id: "handbook-travel",
    title: "旅行手账插画",
    category: "手账插画",
    level: "入门",
    tags: ["手账", "贴纸", "旅行"],
    ratio: "1536x1024",
    description: "生成手写笔记、贴纸、票根拼贴风页面。",
    prompt:
      "创作一页旅行手账插画，主题是周末城市漫游。画面包含手绘地图、咖啡杯、地铁票、拍立得照片、天气小图标、中文手写注释和几枚可爱贴纸。纸张有自然纹理，墨水笔触清晰，排版松弛但有秩序，色彩温暖，像真实手账扫描图。",
  },
  {
    id: "photo-doodle",
    title: "照片涂鸦增强",
    category: "营销创意",
    level: "入门",
    tags: ["图生图", "涂鸦", "社交"],
    ratio: "1024x1024",
    description: "适合上传照片后做趣味增强。",
    prompt:
      "基于上传的照片进行创意涂鸦增强，保持原始主体和构图不变，在周围添加白色手绘线条、箭头、小星星、中文便签、夸张表情符号和轻微发光标注。效果要像设计师在照片上做了精致手绘批注，活泼但不杂乱，适合社交媒体封面。",
  },
];
