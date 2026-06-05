/**
 * rules.js - Optimized routing rules
 * AI services split individually, streaming/social consolidated reasonably
 */

const REJECT_DOMAINS = [
  'DOMAIN-SUFFIX,googleadservices.com','DOMAIN-SUFFIX,googlesyndication.com',
  'DOMAIN-SUFFIX,doubleclick.net','DOMAIN-SUFFIX,adservice.google.com',
  'DOMAIN-SUFFIX,ads.facebook.com','DOMAIN-SUFFIX,an.facebook.com',
  'DOMAIN-SUFFIX,adcolony.com','DOMAIN-SUFFIX,admob.com','DOMAIN-SUFFIX,adsrvr.org',
  'DOMAIN-SUFFIX,adnxs.com','DOMAIN-SUFFIX,appsflyer.com','DOMAIN-SUFFIX,adjust.com',
  'DOMAIN-SUFFIX,branch.io','DOMAIN-SUFFIX,crashlytics.com','DOMAIN-SUFFIX,flurry.com',
  'DOMAIN-SUFFIX,vungle.com','DOMAIN-SUFFIX,chartboost.com','DOMAIN-SUFFIX,ironsrc.com',
  'DOMAIN-SUFFIX,amplitude.com','DOMAIN-SUFFIX,mixpanel.com',
  'DOMAIN-KEYWORD,adservice','DOMAIN-KEYWORD,adtrack',
  'DOMAIN-KEYWORD,umeng','DOMAIN-KEYWORD,cnzz','DOMAIN-SUFFIX,51.la',
];

// ===== AI 独立分组 =====
const AI_OPENAI = [
  'DOMAIN-SUFFIX,openai.com','DOMAIN-SUFFIX,chatgpt.com','DOMAIN-SUFFIX,oaistatic.com',
  'DOMAIN-SUFFIX,oaiusercontent.com','DOMAIN-SUFFIX,sora.com',
  'DOMAIN-SUFFIX,cdn.oaistatic.com','DOMAIN-SUFFIX,auth0.openai.com',
];

const AI_CLAUDE = [
  'DOMAIN-SUFFIX,anthropic.com','DOMAIN-SUFFIX,claude.ai',
  'DOMAIN-SUFFIX,claudeusercontent.com',
];

const AI_GEMINI = [
  'DOMAIN-SUFFIX,gemini.google.com','DOMAIN-SUFFIX,bard.google.com',
  'DOMAIN-SUFFIX,aistudio.google.com','DOMAIN-SUFFIX,deepmind.com',
  'DOMAIN-SUFFIX,deepmind.google','DOMAIN-SUFFIX,generativelanguage.googleapis.com',
  'DOMAIN-SUFFIX,makersuite.google.com','DOMAIN-SUFFIX,notebooklm.google.com',
  'DOMAIN-SUFFIX,ai.google.dev',
];

const AI_COPILOT = [
  'DOMAIN-SUFFIX,copilot.microsoft.com','DOMAIN-SUFFIX,sydney.bing.com',
  'DOMAIN-SUFFIX,edgeservices.bing.com','DOMAIN-SUFFIX,copilot.cloud.microsoft',
];

const AI_KIRO = [
  'DOMAIN-SUFFIX,kiro.dev',
];

const AI_OTHER = [
  'DOMAIN-SUFFIX,x.ai','DOMAIN-SUFFIX,grok.x.ai',
  'DOMAIN-SUFFIX,meta.ai','DOMAIN-SUFFIX,llama.meta.com',
  'DOMAIN-SUFFIX,perplexity.ai','DOMAIN-SUFFIX,huggingface.co',
  'DOMAIN-SUFFIX,replicate.com','DOMAIN-SUFFIX,together.ai',
  'DOMAIN-SUFFIX,groq.com','DOMAIN-SUFFIX,mistral.ai',
  'DOMAIN-SUFFIX,cohere.ai','DOMAIN-SUFFIX,cohere.com',
  'DOMAIN-SUFFIX,poe.com','DOMAIN-SUFFIX,character.ai',
  'DOMAIN-SUFFIX,midjourney.com','DOMAIN-SUFFIX,stability.ai',
  'DOMAIN-SUFFIX,runway.ml','DOMAIN-SUFFIX,runwayml.com',
  'DOMAIN-SUFFIX,civitai.com','DOMAIN-SUFFIX,cursor.sh','DOMAIN-SUFFIX,cursor.com',
  'DOMAIN-SUFFIX,v0.dev','DOMAIN-SUFFIX,bolt.new','DOMAIN-SUFFIX,windsurf.com',
  'DOMAIN-SUFFIX,codeium.com','DOMAIN-SUFFIX,suno.com','DOMAIN-SUFFIX,elevenlabs.io',
  'DOMAIN-SUFFIX,dify.ai','DOMAIN-SUFFIX,coze.com',
];

// ===== 流媒体独立分组 =====
const YOUTUBE = [
  'DOMAIN-SUFFIX,youtube.com','DOMAIN-SUFFIX,youtu.be','DOMAIN-SUFFIX,ytimg.com',
  'DOMAIN-SUFFIX,googlevideo.com','DOMAIN-SUFFIX,youtube-nocookie.com',
  'DOMAIN-SUFFIX,yt.be','DOMAIN-SUFFIX,yt3.ggpht.com',
  'DOMAIN-SUFFIX,youtubei.googleapis.com','DOMAIN-SUFFIX,music.youtube.com',
];

const NETFLIX = [
  'DOMAIN-SUFFIX,netflix.com','DOMAIN-SUFFIX,netflix.net','DOMAIN-SUFFIX,nflxext.com',
  'DOMAIN-SUFFIX,nflximg.com','DOMAIN-SUFFIX,nflximg.net','DOMAIN-SUFFIX,nflxso.net',
  'DOMAIN-SUFFIX,nflxvideo.net',
];

const DISNEY = [
  'DOMAIN-SUFFIX,disneyplus.com','DOMAIN-SUFFIX,disney-plus.net',
  'DOMAIN-SUFFIX,bamgrid.com','DOMAIN-SUFFIX,dssott.com',
  'DOMAIN-SUFFIX,disneystreaming.com',
];

const SPOTIFY = [
  'DOMAIN-SUFFIX,spotify.com','DOMAIN-SUFFIX,spotifycdn.com',
  'DOMAIN-SUFFIX,scdn.co','DOMAIN-SUFFIX,pscdn.co',
];

const STREAMING_OTHER = [
  'DOMAIN-SUFFIX,tiktok.com','DOMAIN-SUFFIX,tiktokv.com','DOMAIN-SUFFIX,tiktokcdn.com',
  'DOMAIN-SUFFIX,twitch.tv','DOMAIN-SUFFIX,twitchcdn.net','DOMAIN-SUFFIX,ttvnw.net',
  'DOMAIN-SUFFIX,hbomax.com','DOMAIN-SUFFIX,hbo.com','DOMAIN-SUFFIX,max.com',
  'DOMAIN-SUFFIX,primevideo.com','DOMAIN-SUFFIX,amazonvideo.com','DOMAIN-SUFFIX,aiv-cdn.net',
  'DOMAIN-SUFFIX,hulu.com','DOMAIN-SUFFIX,crunchyroll.com',
  'DOMAIN-SUFFIX,paramountplus.com','DOMAIN-SUFFIX,peacocktv.com',
  'DOMAIN-SUFFIX,dazn.com','DOMAIN-SUFFIX,biliintl.com',
  'DOMAIN-SUFFIX,abema.tv','DOMAIN-SUFFIX,nicovideo.jp',
  'DOMAIN-SUFFIX,viu.com','DOMAIN-SUFFIX,discoveryplus.com',
];

// ===== 社交合理分组 =====
const TELEGRAM = [
  'DOMAIN-SUFFIX,telegram.org','DOMAIN-SUFFIX,t.me','DOMAIN-SUFFIX,telegra.ph',
  'DOMAIN-SUFFIX,telegram.me','DOMAIN-SUFFIX,telesco.pe',
  'DOMAIN-SUFFIX,tdesktop.com','DOMAIN-SUFFIX,telegram.dog',
  'IP-CIDR,91.108.4.0/22,no-resolve','IP-CIDR,91.108.8.0/22,no-resolve',
  'IP-CIDR,91.108.12.0/22,no-resolve','IP-CIDR,91.108.16.0/22,no-resolve',
  'IP-CIDR,91.108.20.0/22,no-resolve','IP-CIDR,91.108.56.0/22,no-resolve',
  'IP-CIDR,149.154.160.0/20,no-resolve',
  'IP-CIDR6,2001:b28:f23d::/48,no-resolve','IP-CIDR6,2001:b28:f23f::/48,no-resolve',
  'IP-CIDR6,2001:67c:4e8::/48,no-resolve',
];

const TWITTER = [
  'DOMAIN-SUFFIX,twitter.com','DOMAIN-SUFFIX,x.com','DOMAIN-SUFFIX,twimg.com',
  'DOMAIN-SUFFIX,t.co','DOMAIN-SUFFIX,tweetdeck.com',
];

const SOCIAL_OTHER = [
  'DOMAIN-SUFFIX,instagram.com','DOMAIN-SUFFIX,cdninstagram.com',
  'DOMAIN-SUFFIX,facebook.com','DOMAIN-SUFFIX,facebook.net',
  'DOMAIN-SUFFIX,fbcdn.net','DOMAIN-SUFFIX,fb.com','DOMAIN-SUFFIX,messenger.com',
  'DOMAIN-SUFFIX,threads.net',
  'DOMAIN-SUFFIX,whatsapp.com','DOMAIN-SUFFIX,whatsapp.net',
  'DOMAIN-SUFFIX,discord.com','DOMAIN-SUFFIX,discord.gg','DOMAIN-SUFFIX,discordapp.com',
  'DOMAIN-SUFFIX,reddit.com','DOMAIN-SUFFIX,redd.it','DOMAIN-SUFFIX,redditmedia.com',
  'DOMAIN-SUFFIX,line.me','DOMAIN-SUFFIX,line-scdn.net','DOMAIN-SUFFIX,line-apps.com',
  'DOMAIN-SUFFIX,pinterest.com','DOMAIN-SUFFIX,snapchat.com','DOMAIN-SUFFIX,snap.com',
  'DOMAIN-SUFFIX,linkedin.com','DOMAIN-SUFFIX,signal.org',
];

// ===== Google =====
const GOOGLE = [
  'DOMAIN-SUFFIX,google.com','DOMAIN-SUFFIX,google.co.jp','DOMAIN-SUFFIX,google.com.hk',
  'DOMAIN-SUFFIX,googleapis.com','DOMAIN-SUFFIX,gstatic.com','DOMAIN-SUFFIX,ggpht.com',
  'DOMAIN-SUFFIX,googleusercontent.com','DOMAIN-SUFFIX,googlesource.com',
  'DOMAIN-SUFFIX,blogger.com','DOMAIN-SUFFIX,blogspot.com',
  'DOMAIN-SUFFIX,gmail.com','DOMAIN-SUFFIX,googlemail.com',
  'DOMAIN-SUFFIX,google.cloud','DOMAIN-SUFFIX,withgoogle.com','DOMAIN-SUFFIX,1e100.net',
  'DOMAIN-SUFFIX,google.org','DOMAIN-SUFFIX,gcr.io',
  'DOMAIN-SUFFIX,translate.google.com','DOMAIN-SUFFIX,drive.google.com',
  'DOMAIN-SUFFIX,play.google.com',
];

// ===== Dev =====
const DEV = [
  'DOMAIN-SUFFIX,github.com','DOMAIN-SUFFIX,github.io','DOMAIN-SUFFIX,githubusercontent.com',
  'DOMAIN-SUFFIX,githubassets.com','DOMAIN-SUFFIX,ghcr.io','DOMAIN-SUFFIX,github.dev',
  'DOMAIN-SUFFIX,gitlab.com','DOMAIN-SUFFIX,npmjs.com','DOMAIN-SUFFIX,pypi.org',
  'DOMAIN-SUFFIX,docker.com','DOMAIN-SUFFIX,docker.io',
  'DOMAIN-SUFFIX,stackoverflow.com','DOMAIN-SUFFIX,stackexchange.com',
  'DOMAIN-SUFFIX,medium.com','DOMAIN-SUFFIX,dev.to',
  'DOMAIN-SUFFIX,vercel.com','DOMAIN-SUFFIX,vercel.app',
  'DOMAIN-SUFFIX,netlify.com','DOMAIN-SUFFIX,netlify.app',
  'DOMAIN-SUFFIX,cloudflare.com','DOMAIN-SUFFIX,workers.dev','DOMAIN-SUFFIX,pages.dev',
  'DOMAIN-SUFFIX,notion.so','DOMAIN-SUFFIX,notion.site',
  'DOMAIN-SUFFIX,figma.com',
];

// ===== Gaming =====
const GAMING = [
  'DOMAIN-SUFFIX,steampowered.com','DOMAIN-SUFFIX,steamcommunity.com',
  'DOMAIN-SUFFIX,steamstatic.com','DOMAIN-SUFFIX,steamusercontent.com',
  'DOMAIN-SUFFIX,epicgames.com','DOMAIN-SUFFIX,unrealengine.com',
  'DOMAIN-SUFFIX,playstation.com','DOMAIN-SUFFIX,playstation.net',
  'DOMAIN-SUFFIX,xbox.com','DOMAIN-SUFFIX,xboxlive.com',
  'DOMAIN-SUFFIX,nintendo.com','DOMAIN-SUFFIX,nintendo.net',
  'DOMAIN-SUFFIX,battle.net','DOMAIN-SUFFIX,blizzard.com',
  'DOMAIN-SUFFIX,ea.com','DOMAIN-SUFFIX,riotgames.com',
  'DOMAIN-SUFFIX,mihoyo.com','DOMAIN-SUFFIX,hoyoverse.com',
];

// ===== Apple =====
const APPLE = [
  'DOMAIN-SUFFIX,apple.com','DOMAIN-SUFFIX,icloud.com',
  'DOMAIN-SUFFIX,icloud-content.com','DOMAIN-SUFFIX,mzstatic.com',
  'DOMAIN-SUFFIX,apple-cloudkit.com','DOMAIN-SUFFIX,cdn-apple.com',
  'DOMAIN-SUFFIX,aaplimg.com','DOMAIN-SUFFIX,appstore.com','DOMAIN-SUFFIX,me.com',
];

// ===== Microsoft =====
const MICROSOFT = [
  'DOMAIN-SUFFIX,microsoft.com','DOMAIN-SUFFIX,microsoftonline.com',
  'DOMAIN-SUFFIX,office.com','DOMAIN-SUFFIX,office365.com',
  'DOMAIN-SUFFIX,outlook.com','DOMAIN-SUFFIX,live.com','DOMAIN-SUFFIX,live.net',
  'DOMAIN-SUFFIX,hotmail.com','DOMAIN-SUFFIX,skype.com',
  'DOMAIN-SUFFIX,windows.com','DOMAIN-SUFFIX,windows.net',
  'DOMAIN-SUFFIX,aka.ms','DOMAIN-SUFFIX,azure.com','DOMAIN-SUFFIX,visualstudio.com',
  'DOMAIN-SUFFIX,onedrive.com','DOMAIN-SUFFIX,sharepoint.com',
  'DOMAIN-SUFFIX,bing.com','DOMAIN-SUFFIX,bing.net',
  'DOMAIN-SUFFIX,msedge.net','DOMAIN-SUFFIX,msftconnecttest.com',
];

// ===== Proxy General =====
const PROXY_GENERAL = [
  'DOMAIN-SUFFIX,wikipedia.org','DOMAIN-SUFFIX,wikimedia.org',
  'DOMAIN-SUFFIX,nytimes.com','DOMAIN-SUFFIX,washingtonpost.com',
  'DOMAIN-SUFFIX,bbc.com','DOMAIN-SUFFIX,bbc.co.uk','DOMAIN-SUFFIX,cnn.com',
  'DOMAIN-SUFFIX,reuters.com','DOMAIN-SUFFIX,bloomberg.com',
  'DOMAIN-SUFFIX,protonmail.com','DOMAIN-SUFFIX,proton.me',
  'DOMAIN-SUFFIX,1password.com','DOMAIN-SUFFIX,bitwarden.com',
  'DOMAIN-SUFFIX,amazon.com','DOMAIN-SUFFIX,amazon.co.jp','DOMAIN-SUFFIX,ebay.com',
  'DOMAIN-SUFFIX,paypal.com','DOMAIN-SUFFIX,duckduckgo.com',
  'DOMAIN-SUFFIX,dropbox.com','DOMAIN-SUFFIX,mega.nz',
  'DOMAIN-SUFFIX,pixiv.net','DOMAIN-SUFFIX,pximg.net','DOMAIN-SUFFIX,imgur.com',
  'DOMAIN-SUFFIX,zoom.us','DOMAIN-SUFFIX,slack.com',
  'DOMAIN-SUFFIX,grammarly.com','DOMAIN-SUFFIX,quora.com',
  'DOMAIN-SUFFIX,archive.org',
];

// ===== China Direct =====
const DIRECT_DOMAINS = [
  'DOMAIN-SUFFIX,cn',
  'DOMAIN-SUFFIX,baidu.com','DOMAIN-SUFFIX,bdstatic.com','DOMAIN-SUFFIX,bdimg.com',
  'DOMAIN-SUFFIX,qq.com','DOMAIN-SUFFIX,gtimg.com','DOMAIN-SUFFIX,qpic.cn',
  'DOMAIN-SUFFIX,weixin.com','DOMAIN-SUFFIX,wechat.com',
  'DOMAIN-SUFFIX,taobao.com','DOMAIN-SUFFIX,tmall.com','DOMAIN-SUFFIX,alibaba.com',
  'DOMAIN-SUFFIX,alicdn.com','DOMAIN-SUFFIX,alipay.com','DOMAIN-SUFFIX,1688.com',
  'DOMAIN-SUFFIX,aliyun.com','DOMAIN-SUFFIX,aliyuncs.com',
  'DOMAIN-SUFFIX,jd.com','DOMAIN-SUFFIX,360buyimg.com',
  'DOMAIN-SUFFIX,douyin.com','DOMAIN-SUFFIX,douyinpic.com','DOMAIN-SUFFIX,douyincdn.com',
  'DOMAIN-SUFFIX,toutiao.com','DOMAIN-SUFFIX,bytedance.com',
  'DOMAIN-SUFFIX,zhihu.com','DOMAIN-SUFFIX,zhimg.com',
  'DOMAIN-SUFFIX,weibo.com','DOMAIN-SUFFIX,weibo.cn','DOMAIN-SUFFIX,sinaimg.cn',
  'DOMAIN-SUFFIX,163.com','DOMAIN-SUFFIX,126.com','DOMAIN-SUFFIX,netease.com',
  'DOMAIN-SUFFIX,bilibili.com','DOMAIN-SUFFIX,bilivideo.com','DOMAIN-SUFFIX,hdslb.com',
  'DOMAIN-SUFFIX,iqiyi.com','DOMAIN-SUFFIX,youku.com',
  'DOMAIN-SUFFIX,kuaishou.com','DOMAIN-SUFFIX,xiaohongshu.com','DOMAIN-SUFFIX,xhscdn.com',
  'DOMAIN-SUFFIX,xiaomi.com','DOMAIN-SUFFIX,miui.com','DOMAIN-SUFFIX,mi.com',
  'DOMAIN-SUFFIX,huawei.com','DOMAIN-SUFFIX,vmall.com',
  'DOMAIN-SUFFIX,meituan.com','DOMAIN-SUFFIX,dianping.com',
  'DOMAIN-SUFFIX,pinduoduo.com','DOMAIN-SUFFIX,suning.com',
  'DOMAIN-SUFFIX,ctrip.com','DOMAIN-SUFFIX,eleme.cn','DOMAIN-SUFFIX,ele.me',
  'DOMAIN-SUFFIX,douban.com','DOMAIN-SUFFIX,feishu.cn','DOMAIN-SUFFIX,dingtalk.com',
  'DOMAIN-SUFFIX,csdn.net','DOMAIN-SUFFIX,gitee.com','DOMAIN-SUFFIX,cnblogs.com',
  'DOMAIN-SUFFIX,qcloud.com','DOMAIN-SUFFIX,myqcloud.com',
  'DOMAIN-SUFFIX,unionpay.com',
  'GEOIP,CN',
];

// ===== Private / LAN =====
const PRIVATE_RULES = [
  'DOMAIN-SUFFIX,local','DOMAIN-SUFFIX,localhost',
  'IP-CIDR,10.0.0.0/8,no-resolve','IP-CIDR,17.0.0.0/8,no-resolve',
  'IP-CIDR,100.64.0.0/10,no-resolve','IP-CIDR,127.0.0.0/8,no-resolve',
  'IP-CIDR,172.16.0.0/12,no-resolve','IP-CIDR,192.168.0.0/16,no-resolve',
  'IP-CIDR6,::1/128,no-resolve','IP-CIDR6,fc00::/7,no-resolve',
  'IP-CIDR6,fe80::/10,no-resolve',
];

// ================================================

function appendGroup(rule, group) {
  if (rule.includes(',no-resolve')) return rule.replace(',no-resolve', `,${group},no-resolve`);
  return `${rule},${group}`;
}

function getClashRules() {
  const rules = [];
  const add = (arr, grp) => arr.forEach(r => rules.push(appendGroup(r, grp)));

  add(PRIVATE_RULES, 'DIRECT');
  add(REJECT_DOMAINS, '🚫 广告拦截');

  // AI
  add(AI_OPENAI, '🤖 OpenAI');
  add(AI_CLAUDE, '🧠 Claude');
  add(AI_GEMINI, '💎 Gemini');
  add(AI_COPILOT, '🪟 Copilot');
  add(AI_KIRO, '🛠 Kiro');
  add(AI_OTHER, '🔮 AI其他');

  // Streaming
  add(YOUTUBE, '📺 YouTube');
  add(NETFLIX, '🎬 Netflix');
  add(DISNEY, '🏰 Disney+');
  add(SPOTIFY, '🎵 Spotify');
  add(STREAMING_OTHER, '📽 流媒体其他');

  // Social
  add(TELEGRAM, '✈️ Telegram');
  add(TWITTER, '🐦 Twitter/X');
  add(SOCIAL_OTHER, '💬 社交媒体');

  // Services
  add(GOOGLE, '🌐 谷歌服务');
  add(DEV, '💻 开发者');
  add(GAMING, '🎮 游戏平台');
  add(APPLE, '🍎 苹果服务');
  add(MICROSOFT, '🪟 微软服务');
  add(DIRECT_DOMAINS, '🇨🇳 国内直连');
  add(PROXY_GENERAL, '🚀 节点选择');

  rules.push('MATCH,🐟 漏网之鱼');
  return rules;
}

function getProxyGroups() {
  return [
    { name: '🚀 节点选择', type: 'select', useAll: true, extra: ['♻️ 自动选优', 'DIRECT'] },
    { name: '♻️ 自动选优', type: 'url-test', useAll: true },

    // AI (5 groups)
    { name: '🤖 OpenAI', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '🧠 Claude', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '💎 Gemini', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '🪟 Copilot', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '🛠 Kiro', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '🔮 AI其他', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },

    // Streaming (5 groups)
    { name: '📺 YouTube', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '🎬 Netflix', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '🏰 Disney+', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '🎵 Spotify', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优', 'DIRECT'], useRegion: true, useAll: true },
    { name: '📽 流媒体其他', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },

    // Social (3 groups)
    { name: '✈️ Telegram', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '🐦 Twitter/X', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'], useRegion: true, useAll: true },
    { name: '💬 社交媒体', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优'] , useAll: true },

    // Services (5 groups)
    { name: '🌐 谷歌服务', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优', 'DIRECT'] , useAll: true },
    { name: '💻 开发者', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优', 'DIRECT'] , useAll: true },
    { name: '🎮 游戏平台', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优', 'DIRECT'] , useAll: true },
    { name: '🍎 苹果服务', type: 'select', extra: ['DIRECT', '🚀 节点选择'] , useAll: true },
    { name: '🪟 微软服务', type: 'select', extra: ['DIRECT', '🚀 节点选择'] , useAll: true },

    // System (3 groups)
    { name: '🇨🇳 国内直连', type: 'select', extra: ['DIRECT', '🚀 节点选择'] },
    { name: '🚫 广告拦截', type: 'select', extra: ['REJECT', 'DIRECT'] },
    { name: '🐟 漏网之鱼', type: 'select', extra: ['🚀 节点选择', '♻️ 自动选优', 'DIRECT'] , useAll: true },
  ];
}

function getRegionGroups() {
  return {
    // NOTE: 主要地区
    'HK': { name: '🇭🇰 香港', emoji: '🇭🇰' },
    'JP': { name: '🇯🇵 日本', emoji: '🇯🇵' },
    'SG': { name: '🇸🇬 新加坡', emoji: '🇸🇬' },
    'US': { name: '🇺🇸 美国', emoji: '🇺🇸' },
    'TW': { name: '🇹🇼 台湾', emoji: '🇹🇼' },
    'KR': { name: '🇰🇷 韩国', emoji: '🇰🇷' },
    'UK': { name: '🇬🇧 英国', emoji: '🇬🇧' },
    'DE': { name: '🇩🇪 德国', emoji: '🇩🇪' },
    'AU': { name: '🇦🇺 澳洲', emoji: '🇦🇺' },
    'CA': { name: '🇨🇦 加拿大', emoji: '🇨🇦' },
    'FR': { name: '🇫🇷 法国', emoji: '🇫🇷' },
    'NL': { name: '🇳🇱 荷兰', emoji: '🇳🇱' },
    'RU': { name: '🇷🇺 俄罗斯', emoji: '🇷🇺' },
    'IN': { name: '🇮🇳 印度', emoji: '🇮🇳' },
    // NOTE: 南美洲
    'AR': { name: '🇦🇷 阿根廷', emoji: '🇦🇷' },
    'BR': { name: '🇧🇷 巴西', emoji: '🇧🇷' },
    'CL': { name: '🇨🇱 智利', emoji: '🇨🇱' },
    'CO': { name: '🇨🇴 哥伦比亚', emoji: '🇨🇴' },
    'UY': { name: '🇺🇾 乌拉圭', emoji: '🇺🇾' },
    'PE': { name: '🇵🇪 秘鲁', emoji: '🇵🇪' },
    'MX': { name: '🇲🇽 墨西哥', emoji: '🇲🇽' },
    'EC': { name: '🇪🇨 厄瓜多尔', emoji: '🇪🇨' },
    // NOTE: 东南亚
    'TH': { name: '🇹🇭 泰国', emoji: '🇹🇭' },
    'VN': { name: '🇻🇳 越南', emoji: '🇻🇳' },
    'PH': { name: '🇵🇭 菲律宾', emoji: '🇵🇭' },
    'MY': { name: '🇲🇾 马来西亚', emoji: '🇲🇾' },
    'ID': { name: '🇮🇩 印尼', emoji: '🇮🇩' },
    // NOTE: 中东
    'TR': { name: '🇹🇷 土耳其', emoji: '🇹🇷' },
    'AE': { name: '🇦🇪 阿联酋', emoji: '🇦🇪' },
    'IL': { name: '🇮🇱 以色列', emoji: '🇮🇱' },
    // NOTE: 其他欧洲
    'IT': { name: '🇮🇹 意大利', emoji: '🇮🇹' },
    'ES': { name: '🇪🇸 西班牙', emoji: '🇪🇸' },
    'SE': { name: '🇸🇪 瑞典', emoji: '🇸🇪' },
    'CH': { name: '🇨🇭 瑞士', emoji: '🇨🇭' },
    'PL': { name: '🇵🇱 波兰', emoji: '🇵🇱' },
    'IE': { name: '🇮🇪 爱尔兰', emoji: '🇮🇪' },
    'ZA': { name: '🇿🇦 南非', emoji: '🇿🇦' },
    'OTHER': { name: '🌍 其他', emoji: '🌍' },
  };
}

function getSingboxRuleCategories() {
  return {
    reject: REJECT_DOMAINS,
    ai_openai: AI_OPENAI, ai_claude: AI_CLAUDE, ai_gemini: AI_GEMINI,
    ai_copilot: AI_COPILOT, ai_other: AI_OTHER,
    youtube: YOUTUBE, netflix: NETFLIX, disney: DISNEY, spotify: SPOTIFY,
    streaming_other: STREAMING_OTHER,
    telegram: TELEGRAM, twitter: TWITTER, social_other: SOCIAL_OTHER,
    google: GOOGLE, dev: DEV, gaming: GAMING,
    apple: APPLE, microsoft: MICROSOFT,
    direct: DIRECT_DOMAINS, proxy: PROXY_GENERAL, private: PRIVATE_RULES,
  };
}

module.exports = {
  getClashRules, getProxyGroups, getRegionGroups, getSingboxRuleCategories,
  REJECT_DOMAINS, AI_OPENAI, AI_CLAUDE, AI_GEMINI, AI_COPILOT, AI_KIRO, AI_OTHER,
  YOUTUBE, NETFLIX, DISNEY, SPOTIFY, STREAMING_OTHER,
  TELEGRAM, TWITTER, SOCIAL_OTHER,
  GOOGLE, DEV, GAMING, APPLE, MICROSOFT, DIRECT_DOMAINS, PROXY_GENERAL, PRIVATE_RULES,
};
