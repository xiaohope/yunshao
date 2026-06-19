package com.yxq.yunshao;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import fi.iki.elonen.NanoHTTPD;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.*;
import java.util.concurrent.*;

public class YunShaoServer extends NanoHTTPD {
    private static final String TAG = "YunShaoServer";
    private Context context;
    private ExecutorService executor = Executors.newFixedThreadPool(12);
    private JSONArray sources;
    private JSONArray customSources = new JSONArray(); // 前端同步的自定义采集源
    private String homeCache = null;
    private long homeCacheTime = 0;
    private static final long HOME_CACHE_TTL = 5 * 60 * 1000;
    private static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";

    // ========== 首页缓存预热（后台线程，不阻塞启动） ==========
    private boolean isWarmingUp = false;

    /**
     * 后台预热首页缓存：提前获取各源数据，让第一次API请求秒回
     */
    public void warmupHomeCache() {
        if (isWarmingUp) return;
        isWarmingUp = true;
        new Thread(() -> {
            try {
                Log.d(TAG, "Starting home cache warmup...");
                JSONArray allSources = getAllSources();
                int max = Math.min(allSources.length(), 2);
                for (int si = 0; si < max; si++) {
                    JSONObject src = allSources.getJSONObject(si);
                    try {
                        String apiUrl = src.optString("api_url", src.optString("url", ""));
                        if (!apiUrl.isEmpty() && src.optBoolean("enabled", true)) {
                            fetchUrl(apiUrl + "?ac=detail&pg=1");
                        }
                    } catch (Exception ignored) {}
                }
                Log.d(TAG, "Home cache warmup done");
            } catch (Exception e) {
                Log.e(TAG, "Home cache warmup error", e);
            } finally {
                isWarmingUp = false;
            }
        }, "home-warmup").start();
    }

    // ========== 优化1: 降低超时时间 ==========
    private static final int CONNECT_TIMEOUT = 5000;   // 连接超时 5秒 (原15秒)
    private static final int READ_TIMEOUT = 10000;     // 读取超时 10秒 (原30秒)
    private static final int FUTURE_GET_TIMEOUT = 8;   // Future.get 超时 8秒 (原12秒，首页用更短超时)

    // ========== 优化2: 分类页缓存 ==========
    private Map<String, String> categoryCacheMap = new ConcurrentHashMap<>();
    private Map<String, Long> categoryCacheTimeMap = new ConcurrentHashMap<>();
    private static final long CATEGORY_CACHE_TTL = 3 * 60 * 1000; // 分类缓存3分钟

    // ========== 豆瓣API缓存 ==========
    private Map<String, String> doubanCacheMap = new ConcurrentHashMap<>();
    private Map<String, Long> doubanCacheTimeMap = new ConcurrentHashMap<>();
    private static final long DOUBAN_CACHE_TTL = 60 * 60 * 1000; // 豆瓣缓存1小时

    // ========== TMDB API配置 ==========
    private String TMDB_API_KEY = "9f0c7af18af62e07f67f2439942e5042"; // 默认值，将从配置文件读取
    private String TMDB_BASE_URL = "https://api.themoviedb.org/3";
    private String TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
    private Map<String, String> tmdbCacheMap = new ConcurrentHashMap<>();
    private Map<String, Long> tmdbCacheTimeMap = new ConcurrentHashMap<>();
    private static final long TMDB_CACHE_TTL = 60 * 60 * 1000; // TMDB缓存1小时

    public YunShaoServer(Context context) {
        super("127.0.0.1", 8989);
        this.context = context;
        loadConfig();  // 从配置文件读取配置
        initSources();
    }

    /**
     * 从 assets/config.json 读取配置（TMDB_API_KEY等）
     */
    private void loadConfig() {
        try {
            InputStream is = context.getAssets().open("config.json");
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            int n;
            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
            is.close();
            String jsonStr = bos.toString("UTF-8");
            JSONObject config = new JSONObject(jsonStr);
            
            // 读取 TMDB 配置
            if (config.has("tmdb_api_key")) {
                TMDB_API_KEY = config.getString("tmdb_api_key");
            }
            if (config.has("tmdb_base_url")) {
                TMDB_BASE_URL = config.getString("tmdb_base_url");
            }
            if (config.has("tmdb_image_base")) {
                TMDB_IMAGE_BASE = config.getString("tmdb_image_base");
            }
            
            Log.d(TAG, "Config loaded from config.json");
        } catch (Exception e) {
            Log.e(TAG, "Failed to load config.json, using defaults", e);
        }
    }

    private void initSources() {
        sources = new JSONArray();
        try {
            String[][] defaults = {
                {"1", "爱奇艺", "https://iqiyizyapi.com/api.php/provide/vod/"},
                {"2", "虎牙", "https://www.huyaapi.com/api.php/provide/vod/"},
                {"3", "极速", "https://jszyapi.com/api.php/provide/vod/"},
                {"4", "猫眼", "https://api.maoyanapi.top/api.php/provide/vod/"},
                {"5", "暴风", "https://bfzyapi.com/api.php/provide/vod/"},
                {"6", "量子", "https://cj.lziapi.com/api.php/provide/vod/"},
                {"7", "光速", "https://api.guangsuapi.com/api.php/provide/vod/"},
            };
            for (String[] s : defaults) {
                JSONObject src = new JSONObject();
                src.put("id", Integer.parseInt(s[0]));
                src.put("name", s[1]);
                src.put("api_url", s[2]);
                src.put("enabled", true);
                sources.put(src);
            }
        } catch (Exception e) { Log.e(TAG, "initSources failed", e); }
    }

    private void appendToArray(JSONArray target, JSONArray source) {
        if (source != null) {
            for (int i = 0; i < source.length(); i++) {
                try { target.put(source.get(i)); } catch (Exception e) {}
            }
        }
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        try {
            if (uri.startsWith("/api/")) return handleApi(uri, session);
            return serveStatic(uri);
        } catch (Exception e) {
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", e.getMessage());
        }
    }

    private Response handleApi(String uri, IHTTPSession session) throws Exception {
        Map<String, String> params = new HashMap<>();
        params.putAll(session.getParms());
        if (session.getQueryParameterString() != null) {
            for (String pair : session.getQueryParameterString().split("&")) {
                String[] kv = pair.split("=", 2);
                if (kv.length == 2) params.put(kv[0], java.net.URLDecoder.decode(kv[1], "UTF-8"));
            }
        }
        // 处理POST请求体（自定义源同步）
        if (Method.POST.equals(session.getMethod()) && uri.equals("/api/sources/sync")) {
            return apiSourcesSync(session);
        }
        if (uri.equals("/api/home")) return apiHome();
        else if (uri.equals("/api/category")) return apiCategory(params);
        else if (uri.equals("/api/video/list")) {
            int sourceId = Integer.parseInt(params.getOrDefault("source_id", "1"));
            int pg = Integer.parseInt(params.getOrDefault("pg", "1"));
            String t = params.get("t"); String wd = params.get("wd");
            return apiVideoList(sourceId, pg, t, wd);
        } else if (uri.equals("/api/video/detail")) {
            int sourceId = Integer.parseInt(params.getOrDefault("source_id", "1"));
            int ids = Integer.parseInt(params.getOrDefault("ids", "0"));
            return apiVideoDetail(sourceId, ids);
        } else if (uri.equals("/api/search")) {
            return apiSearch(params.getOrDefault("wd", ""));
        } else if (uri.equals("/api/search/source")) {
            return apiSearchSource(params.getOrDefault("url", ""), params.getOrDefault("wd", ""));
        } else if (uri.equals("/api/video/detail/url")) {
            return apiVideoDetailByUrl(params.getOrDefault("url", ""), params.getOrDefault("ids", "0"));
        } else if (uri.equals("/api/sources")) {
            // 只返回内置源（自定义源由前端localStorage管理，不需要通过此接口展示）
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", new JSONObject().put("sources", sources).toString());
        } else if (uri.equals("/api/live/fetch")) {
            return apiLiveFetch(params.getOrDefault("url", ""));
        } else if (uri.equals("/api/hot")) {
            return apiHotKeywords();
        }
        // ========== 豆瓣API路由 ==========
        else if (uri.equals("/api/douban/home")) return apiDoubanHome();
        else if (uri.equals("/api/douban/subjects")) return apiDoubanSubjects(params);
        else if (uri.equals("/api/douban/tags")) return apiDoubanTags(params);
        else if (uri.equals("/api/douban/detail")) return apiDoubanDetail(params);
        else if (uri.equals("/api/douban/search")) return apiDoubanSearch(params);
        else if (uri.equals("/api/douban/suggest")) return apiDoubanSuggest(params);
        else if (uri.equals("/api/douban/tags/all")) return apiDoubanTagsAll();
        // ========== TMDB API路由 ==========
        else if (uri.equals("/api/tmdb/home")) return apiTmdbHome();
        else if (uri.equals("/api/tmdb/movie/popular")) return apiTmdbMoviePopular(params);
        else if (uri.equals("/api/tmdb/tv/popular")) return apiTmdbTvPopular(params);
        else if (uri.equals("/api/tmdb/search")) return apiTmdbSearch(params);
        else if (uri.equals("/api/tmdb/detail")) return apiTmdbDetail(params);
        else if (uri.equals("/api/tmdb/category")) return apiTmdbCategory(params);
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not Found");
    }

    /**
     * 接收前端同步的自定义采集源
     */
    private Response apiSourcesSync(IHTTPSession session) throws Exception {
        Map<String, String> body = new HashMap<>();
        session.parseBody(body);
        String postData = body.get("postData");
        if (postData == null || postData.isEmpty()) {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Empty body");
        }
        try {
            JSONArray newCustom = new JSONArray(postData);
            // 给自定义源分配id（从100开始，避免与内置源冲突）
            for (int i = 0; i < newCustom.length(); i++) {
                JSONObject src = newCustom.getJSONObject(i);
                if (!src.has("id")) src.put("id", 100 + i);
                if (!src.has("name")) src.put("name", "自定义源" + (i + 1));
                if (!src.has("api_url") && src.has("url")) src.put("api_url", src.getString("url"));
            }
            customSources = newCustom;
            // 清除首页缓存，让下次请求使用新源
            homeCache = null;
            // 清除分类缓存
            categoryCacheMap.clear();
            categoryCacheTimeMap.clear();
            Log.d(TAG, "Custom sources synced: " + customSources.length() + " sources");
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", new JSONObject().put("ok", true).put("count", customSources.length()).toString());
        } catch (Exception e) {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid JSON: " + e.getMessage());
        }
    }

    /**
     * 获取所有可用源 - 合并内置6个源 + 前端同步的自定义源
     */
    private JSONArray getAllSources() {
        JSONArray all = new JSONArray();
        // 先加入内置6个源
        for (int i = 0; i < sources.length(); i++) {
            try { all.put(sources.getJSONObject(i)); } catch (Exception e) {}
        }
        // 再加入前端同步的自定义源
        for (int i = 0; i < customSources.length(); i++) {
            try { all.put(customSources.getJSONObject(i)); } catch (Exception e) {}
        }
        return all;
    }

    // ========== 优化3: apiHome使用CompletionService早返回 + 源评分 ==========
    private static final int HOME_MIN_ITEMS = 30; // 收集到30条就返回
    private static final int SOURCE_MIN_ITEMS = 10; // 单源最少应有10条数据，少于此值认为该源可能失效

    /**
     * 首页API - 单路全量取数据（简化版，减少请求量加快加载）
     * 去掉第2路按分类t参数，因为t参数不靠谱，双路并行反而增加请求量
     * 增加源评分机制：如果某源返回数据过少，自动降低其优先级
     */
    private Response apiHome() throws Exception {
        long now = System.currentTimeMillis();
        if (homeCache != null && (now - homeCacheTime) < HOME_CACHE_TTL) {
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", homeCache);
        }

        JSONArray allSources = getAllSources();
        CompletionService<JSONArray> completionService = new ExecutorCompletionService<>(executor);
        List<Future<JSONArray>> futures = new ArrayList<>();

        // 源评分缓存：sourceId -> 数据量计数
        Map<Integer, Integer> sourceScores = new ConcurrentHashMap<>();

        // 单路：全量取3页（够推荐页6条预览即可）
        for (int si = 0; si < allSources.length(); si++) {
            JSONObject src = allSources.getJSONObject(si);
            final String apiUrl = src.optString("api_url", src.optString("url", ""));
            if (apiUrl.isEmpty()) continue;
            final int sourceId = src.optInt("id", si + 100);
            final String sourceName = src.optString("name", "源" + (si+1));

            // 全量取3页
            for (int p = 1; p <= 3; p++) {
                final int pg = p;
                futures.add(completionService.submit(() -> {
                    try { return parseList(fetchUrl(apiUrl + "?ac=detail&pg=" + pg), sourceId, sourceName); }
                    catch (Exception e) { return new JSONArray(); }
                }));
            }
        }

        // 先到先收，但记录各源数据量用于评分
        JSONArray allItems = new JSONArray();
        Set<String> seenIds = new HashSet<>(); // 去重
        int completed = 0, total = futures.size();
        while (completed < total) {
            try {
                Future<JSONArray> f = completionService.poll(FUTURE_GET_TIMEOUT, TimeUnit.SECONDS);
                if (f == null) break;
                JSONArray result = f.get();
                int resultCount = result.length();
                completed++;
                // 记录该源的数据量（用于后续评分）
                if (resultCount > 0) {
                    try {
                        JSONObject firstItem = result.getJSONObject(0);
                        int sid = firstItem.optInt("_sourceId", 0);
                        if (sid > 0) {
                            sourceScores.merge(sid, resultCount, Integer::sum);
                        }
                    } catch (Exception e) {}
                }
                for (int i = 0; i < result.length(); i++) {
                    try {
                        JSONObject item = result.getJSONObject(i);
                        String dedupKey = item.optString("vod_name", "") + "_" + item.optString("vod_id", "");
                        if (!seenIds.contains(dedupKey)) {
                            seenIds.add(dedupKey);
                            allItems.put(item);
                        }
                    } catch (Exception e) {}
                }
                // 早返回：收集够数据就不再等剩余请求
                if (allItems.length() >= HOME_MIN_ITEMS) break;
            } catch (Exception e) { completed++; }
        }
        // 取消剩余未完成的future
        for (Future<JSONArray> fut : futures) { fut.cancel(true); }

        // 如果收集到的数据很少，说明当前源可能有问题，尝试在错误日志中提示
        if (allItems.length() < SOURCE_MIN_ITEMS) {
            Log.w(TAG, "apiHome: 数据量偏少(" + allItems.length() + ")，可能部分源失效");
        }

        // 智能分类
        JSONArray hot = new JSONArray(), movie = new JSONArray(), tv = new JSONArray();
        JSONArray variety = new JSONArray(), anime = new JSONArray(), shorts = new JSONArray();
        
        int unclassifiedCount = 0; // 未分类计数

        for (int i = 0; i < allItems.length(); i++) {
            try {
                JSONObject item = allItems.getJSONObject(i);
                String typeName = item.optString("type_name", "").toLowerCase();
                String cls = item.optString("vod_class", "").toLowerCase();
                String vodName = item.optString("vod_name", "").toLowerCase();
                String vodBlurb = item.optString("vod_blurb", "").toLowerCase(); // 添加简介字段
                String vodActor = item.optString("vod_actor", "").toLowerCase(); // 演员字段

                // 过滤足球/篮球相关视频（用户不需要）- 必须在加入hot之前过滤
                if (vodName.contains("足球") || vodName.contains("篮球") || 
                    vodBlurb.contains("足球") || vodBlurb.contains("篮球")) {
                    continue;
                }

                if (hot.length() < 30) hot.put(item);

                // 用type_name和vod_class共同判断分类（苹果CMS标准）
                // 改进：添加更多匹配模式，并使用更宽松的匹配
                boolean isAnime = typeName.contains("动漫") || typeName.contains("动画") || 
                                  cls.contains("动漫") || cls.contains("动画") ||
                                  typeName.contains("卡通") || cls.contains("卡通");
                
                boolean isTV = false;
                boolean isMovie = false;
                boolean isVariety = typeName.contains("综艺") || typeName.contains("演唱") || typeName.contains("真人秀") ||
                                   cls.contains("综艺") || cls.contains("演唱") ||
                                   typeName.contains("脱口秀") || cls.contains("脱口秀") ||
                                   typeName.contains("晚会") || cls.contains("晚会");
                
                boolean isShort = cls.contains("短剧") || typeName.contains("短剧") ||
                                  cls.contains("爽剧") || typeName.contains("爽剧") ||
                                  cls.contains("霸总") || typeName.contains("霸总") ||
                                  cls.contains("战神") || typeName.contains("战神") ||
                                  cls.contains("甜宠") || typeName.contains("甜宠") ||
                                  cls.contains("赘婿") || typeName.contains("赘婿") ||
                                  cls.contains("重生") || typeName.contains("重生") ||
                                  cls.contains("穿越") || typeName.contains("穿越");
                
                // 分类优先级：动漫 > 短剧 > 综艺 > 电视剧 > 电影
                if (isAnime) {
                    // 动漫不放入其他分类
                    if (anime.length() < 50) anime.put(item);
                } else if (isShort) {
                    // 短剧单独归类，用于"短剧"Tab
                    if (shorts.length() < 50) shorts.put(item);
                } else if (isVariety) {
                    // 综艺
                    if (variety.length() < 50) variety.put(item);
                } else if (typeName.contains("剧") || cls.contains("剧") || 
                           typeName.contains("连续剧") || cls.contains("连续剧")) {
                    // 电视剧（包含"剧"但不是"动画片"或"XX片"）
                    // 但如果是"喜剧片""动作片"等明确电影类型，还是归电影
                    if (typeName.contains("动作片") || typeName.contains("喜剧片") || typeName.contains("爱情片") ||
                            typeName.contains("科幻片") || typeName.contains("恐怖片") || typeName.contains("剧情片") ||
                            typeName.contains("犯罪片") || typeName.contains("悬疑片") || typeName.contains("动画片") ||
                            typeName.contains("战争片") || typeName.contains("奇幻片") || typeName.contains("冒险片") ||
                            typeName.contains("纪录片") || typeName.contains("电影")) {
                        isMovie = true;
                    } else {
                        isTV = true;
                    }
                } else if (typeName.contains("电影") || typeName.contains("片") || 
                           typeName.contains("影") || cls.contains("电影") ||
                           cls.contains("影院") || cls.contains("院线")) {
                    // 改进：添加更多电影相关关键词
                    isMovie = true;
                } else if (typeName.contains("动作") || typeName.contains("喜剧") || typeName.contains("爱情") ||
                        typeName.contains("科幻") || typeName.contains("恐怖") || typeName.contains("剧情") ||
                        typeName.contains("纪录") || typeName.contains("战争") || 
                        typeName.contains("4k") || typeName.contains("蓝光") ||
                        typeName.contains("冒险") || typeName.contains("悬疑") || typeName.contains("奇幻") ||
                        typeName.contains("惊悚") || typeName.contains("犯罪") || typeName.contains("武侠") ||
                        typeName.contains("古装") || typeName.contains("传记") || typeName.contains("歌舞") ||
                        typeName.contains("情色") || typeName.contains("伦理") ||
                        typeName.contains("恐怖") || typeName.contains("惊悚")) {
                    isMovie = true;
                } else {
                    // 改进：尝试从 vod_name 推断类型
                    if (vodName.contains("电影") || vodName.contains("院线") || 
                        vodName.contains("影院") || vodName.contains("film")) {
                        isMovie = true;
                    } else if (vodName.contains("电视剧") || vodName.contains("剧集") ||
                               vodName.contains("连续剧") || vodName.contains("tv series")) {
                        isTV = true;
                    } else {
                        // 剩余未分类按轮询分配
                        unclassifiedCount++;
                        int idx = i % 4;
                        if (idx == 0 && movie.length() < 50) movie.put(item);
                        else if (idx == 1 && tv.length() < 50) tv.put(item);
                        else if (idx == 2 && variety.length() < 50) variety.put(item);
                        else if (anime.length() < 50) anime.put(item);
                    }
                }
                
                // 分配到对应分类
                if (isMovie && movie.length() < 50) movie.put(item);
                else if (isTV && tv.length() < 50) tv.put(item);
                else if (isVariety && variety.length() < 50) variety.put(item);
                else if (isAnime && anime.length() < 50) anime.put(item);
                
            } catch (Exception e) {
                Log.e(TAG, "分类错误: " + e.getMessage());
            }
        }
        
        // 改进：如果 movie 或 tv 仍然为空，从 hot 中分配一些数据
        if (movie.length() == 0 && hot.length() > 5) {
            Log.w(TAG, "movie 为空，从 hot 中分配数据");
            for (int i = 0; i < Math.min(hot.length(), 10); i++) {
                try {
                    JSONObject item = hot.getJSONObject(i);
                    // 尝试判断是否为电影
                    String typeName = item.optString("type_name", "").toLowerCase();
                    if (!typeName.contains("剧") && !typeName.contains("综艺") && 
                        !typeName.contains("动漫")) {
                        movie.put(item);
                        if (movie.length() >= 6) break;
                    }
                } catch (Exception e) {}
            }
        }
        
        if (tv.length() == 0 && hot.length() > 5) {
            Log.w(TAG, "tv 为空，从 hot 中分配数据");
            for (int i = 0; i < Math.min(hot.length(), 10); i++) {
                try {
                    JSONObject item = hot.getJSONObject(i);
                    // 尝试判断是否为电视剧
                    String typeName = item.optString("type_name", "").toLowerCase();
                    if (typeName.contains("剧") || typeName.contains("连续")) {
                        tv.put(item);
                        if (tv.length() >= 6) break;
                    }
                } catch (Exception e) {}
            }
        }
        
        Log.d(TAG, "分类统计: hot=" + hot.length() + " movie=" + movie.length() + 
                    " tv=" + tv.length() + " variety=" + variety.length() + 
                    " anime=" + anime.length() + " shorts=" + shorts.length() + 
                    " 未分类=" + unclassifiedCount);

        // 过滤无海报、太老的视频，保留2021年至今
        int currentYear = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR);
        JSONArray[] allArrays = {hot, movie, tv, variety, anime};
        for (JSONArray arr : allArrays) {
            JSONArray filtered = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                try {
                    JSONObject item = arr.getJSONObject(i);
                    String pic = item.optString("vod_pic", "");
                    int year = item.optInt("vod_year", 0);
                    // 过滤：无海报 || 年份太老(2020年之前)
                    if (pic.isEmpty() || (!pic.startsWith("http") && !pic.startsWith("/"))) continue;
                    if (year > 0 && year < 2021) continue;
                    filtered.put(item);
                } catch (Exception e) {}
            }
            arr.length(); // 清空原数组
            for (int i = 0; i < filtered.length(); i++) {
                try { arr.put(filtered.get(i)); } catch (Exception e) {}
            }
        }

        sortByYear(hot); sortByYear(movie); sortByYear(tv);
        sortByYear(variety); sortByYear(anime);

        JSONObject result = new JSONObject();
        result.put("hot", hot);
        result.put("short", shorts);
        result.put("movie", movie);
        result.put("tv", tv);
        result.put("variety", variety);
        result.put("anime", anime);

        homeCache = result.toString();
        homeCacheTime = now;
        Log.d(TAG, "apiHome done: total=" + allItems.length() + " hot=" + hot.length() + " movie=" + movie.length() + " tv=" + tv.length() + " variety=" + variety.length() + " anime=" + anime.length());
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", homeCache);
    }

    // ========== 优化4: apiCategory全量取+智能分类 ==========
    private static final int CATEGORY_MIN_ITEMS = 60; // 收集到60条就返回
    private static final int CATEGORY_SMART_PAGE_COUNT = 3; // 智能分类取3页

    /**
     * 分类API - 全量取数据+智能分类，不依赖t参数
     * 支持smart=1模式：全量取+智能分类，和apiHome一致
     */
    private Response apiCategory(Map<String, String> params) throws Exception {
        int pg = Integer.parseInt(params.getOrDefault("pg", "1"));
        String type = params.getOrDefault("type", "0");
        int typeId = Integer.parseInt(type);
        String smart = params.getOrDefault("smart", "0");

        // ========== 分类页缓存 ==========
        String cacheKey = type + "_" + pg + "_smart=" + smart;
        long now = System.currentTimeMillis();
        Long cacheTime = categoryCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < CATEGORY_CACHE_TTL) {
            String cached = categoryCacheMap.get(cacheKey);
            if (cached != null) {
                Log.d(TAG, "apiCategory cache hit: " + cacheKey);
                return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
            }
        }

        JSONArray allSources = getAllSources();
        CompletionService<JSONArray> completionService = new ExecutorCompletionService<>(executor);
        List<Future<JSONArray>> futures = new ArrayList<>();

        // smart=1模式：全量取数据，不依赖t参数
        // 注意：typeId=5（短剧）需要特殊处理，用关键词搜索
        if ("1".equals(smart) && (typeId == 0 || (typeId >= 1 && typeId <= 5))) {
            // 全量取数据
            Log.d(TAG, "apiCategory smart=1: typeId=" + typeId + ", sources count=" + allSources.length());
            for (int si = 0; si < allSources.length(); si++) {
                JSONObject src = allSources.getJSONObject(si);
                final String apiUrl = src.optString("api_url", src.optString("url", ""));
                if (apiUrl.isEmpty()) continue;
                final int sourceId = src.optInt("id", si + 100);
                final String sourceName = src.optString("name", "源" + (si + 1));
                final int tid = typeId;
                Log.d(TAG, "  -> Requesting source: " + sourceName + " (" + apiUrl + ")");

                for (int p = 1; p <= CATEGORY_SMART_PAGE_COUNT; p++) {
                    final int page = p;
                    futures.add(completionService.submit(() -> {
                        try {
                            // 短剧不用wd搜索，直接全量获取后用type_name过滤（部分源不支持wd搜索）
                            String url = apiUrl + "?ac=detail&pg=" + page;
                            JSONArray result = parseList(fetchUrl(url), sourceId, sourceName);
                            Log.d(TAG, "  <- " + sourceName + " page" + page + ": " + result.length() + " items");
                            return result;
                        }
                        catch (Exception e) { Log.e(TAG, "  <- " + sourceName + " page" + page + ": ERROR"); return new JSONArray(); }
                    }));
                }
            }
        } else {
            // 传统模式：按t参数请求
            int maxSources = allSources.length();
            for (int si = 0; si < maxSources; si++) {
                JSONObject src = allSources.getJSONObject(si);
                final String apiUrl = src.optString("api_url", src.optString("url", ""));
                final int sourceId = src.optInt("id", 0);
                final String sourceName = src.optString("name", "");
                final int tid = typeId;
                for (int p = pg; p <= pg + 1; p++) {
                    final int page = p;
                    Future<JSONArray> f = completionService.submit(() -> {
                        try {
                            String url = apiUrl + "?ac=detail&pg=" + page;
                            // 传统模式：1-4用t参数，短剧(tid=5)也直接全量获取后过滤
                            if (tid >= 1 && tid <= 4) url += "&t=" + tid;
                            return parseList(fetchUrl(url), sourceId, sourceName);
                        } catch (Exception e) { return new JSONArray(); }
                    });
                    futures.add(f);
                }
            }
        }

        // 使用CompletionService实现早返回
        JSONArray results = new JSONArray();
        Set<String> seen = new HashSet<>();
        int completedCount = 0;
        int totalFutures = futures.size();

        while (completedCount < totalFutures) {
            try {
                Future<JSONArray> future = completionService.poll(FUTURE_GET_TIMEOUT, TimeUnit.SECONDS);
                if (future == null) {
                    Log.d(TAG, "apiCategory: timeout, collected " + results.length() + " items");
                    break;
                }
                JSONArray list = future.get();
                completedCount++;

                for (int i = 0; i < list.length(); i++) {
                    JSONObject item = list.getJSONObject(i);
                    int t1 = item.optInt("type_id_1", 0);
                    int tid = item.optInt("type_id", 0);
                    String typeName = item.optString("type_name", "").toLowerCase();
                    String cls = item.optString("vod_class", "").toLowerCase();

                    // smart=1模式：智能分类过滤
                    if ("1".equals(smart)) {
                        // type=0时返回所有数据，不做分类过滤
                        if (typeId != 0) {
                            // 短剧分类(typeId==5)：宽松匹配
                            if (typeId == 5) {
                                boolean isShortData = cls.contains("短剧") || typeName.contains("短剧") || 
                                                      cls.contains("爽剧") || typeName.contains("爽剧") ||
                                                      cls.contains("霸总") || typeName.contains("霸总") ||
                                                      cls.contains("战神") || typeName.contains("战神") ||
                                                      cls.contains("甜宠") || typeName.contains("甜宠") ||
                                                      cls.contains("赘婿") || typeName.contains("赘婿");
                                // 短剧分类只接受明确是短剧的内容
                                if (!isShortData) continue;
                            }
                            
                            // 过滤足球/篮球相关视频（用户不需要）
                            String vodName = item.optString("vod_name", "").toLowerCase();
                            if (vodName.contains("足球") || vodName.contains("篮球")) {
                                continue;
                            }

                            // 短剧不进入其他分类
                            boolean isShortData = cls.contains("短剧") || typeName.contains("短剧") ||
                                                  cls.contains("爽剧") || typeName.contains("爽剧") ||
                                                  cls.contains("霸总") || typeName.contains("霸总") ||
                                                  cls.contains("战神") || typeName.contains("战神") ||
                                                  cls.contains("甜宠") || typeName.contains("甜宠") ||
                                                  cls.contains("赘婿") || typeName.contains("赘婿");
                            if (isShortData && typeId != 5) continue;
                            
                            boolean match = false;
                            // 分类逻辑：type_name优先判断
                            // 动漫：type_name包含"动漫"或"动画"
                            if (typeId == 4) {
                                if (typeName.contains("动漫") || typeName.contains("动画")) match = true;
                                if (!match) continue;
                            }
                            // 综艺
                            else if (typeId == 3) {
                                if (typeName.contains("综艺") || typeName.contains("演唱") || typeName.contains("真人秀")) match = true;
                                if (!match) continue;
                            }
                            // 电视剧：type_name包含"剧"但不是"动画片"或"XX片"
                            else if (typeId == 2) {
                                if (typeName.contains("剧") && !typeName.contains("动画片") && !typeName.contains("片")) match = true;
                                if (!match) continue;
                            }
                            // 电影：type_name包含"片"、"电影"、"4k"、"蓝光"
                            else if (typeId == 1) {
                                if (typeName.contains("片") || typeName.contains("电影") || 
                                    typeName.contains("4k") || typeName.contains("蓝光")) match = true;
                                if (!match) continue;
                            }
                            
                            // type_name为空时，用vod_class辅助判断
                            if (!match && typeName.isEmpty() && !cls.isEmpty()) {
                                if (typeId == 4 && (cls.contains("动漫") || cls.contains("动画"))) match = true;
                                else if (typeId == 3 && (cls.contains("综艺") || cls.contains("演唱"))) match = true;
                                else if (typeId == 2 && cls.contains("剧")) match = true;
                                else if (typeId == 1) {
                                    if (cls.contains("动作") || cls.contains("喜剧") || cls.contains("爱情") ||
                                        cls.contains("科幻") || cls.contains("恐怖") || cls.contains("剧情") ||
                                        cls.contains("纪录") || cls.contains("战争") || cls.contains("冒险") ||
                                        cls.contains("悬疑") || cls.contains("奇幻") || cls.contains("惊悚")) match = true;
                                }
                            }
                            if (!match) continue;
                        }
                    } else {
                        // 传统模式：按t参数匹配
                        boolean isShort = tid == 5 || t1 == 5 || cls.contains("短剧") || typeName.contains("短剧");
                        if (typeId == 5 && !isShort) continue;
                        if (typeId != 5 && isShort) continue;

                        if (typeId >= 1 && typeId <= 4) {
                            boolean match = false;
                            if (typeId == 1) match = (t1 == 1 || typeName.contains("电影"));
                            if (typeId == 2) match = (t1 == 2 || typeName.contains("电视剧") || typeName.contains("连续剧"));
                            if (typeId == 3) match = (t1 == 3 || typeName.contains("综艺"));
                            if (typeId == 4) match = (t1 == 4 || typeName.contains("动漫") || typeName.contains("动画"));
                            if (!match && t1 == 0 && typeName.isEmpty()) match = true;
                            if (!match) continue;
                        }
                    }

                    // 去重
                    String key = item.optString("vod_name", "") + "_" + item.optInt("vod_year", 0);
                    if (seen.contains(key)) continue;
                    seen.add(key);
                    results.put(item);
                }

                if (results.length() >= CATEGORY_MIN_ITEMS) {
                    Log.d(TAG, "apiCategory: collected enough items (" + results.length() + "), early return");
                    for (Future<JSONArray> f : futures) {
                        if (!f.isDone()) f.cancel(false);
                    }
                    break;
                }
            } catch (InterruptedException e) {
                break;
            } catch (ExecutionException e) {
                completedCount++;
            }
        }

        // smart=1模式：分页处理
        if ("1".equals(smart)) {
            int pageSize = 30;
            int start = (pg - 1) * pageSize;
            int end = Math.min(start + pageSize, results.length());
            JSONArray paged = new JSONArray();
            for (int i = start; i < end; i++) {
                paged.put(results.get(i));
            }
            results = paged;
        }

        sortByYear(results);

        JSONObject data = new JSONObject();
        data.put("list", results);
        data.put("total", results.length());
        data.put("pg", pg);
        data.put("hasMore", results.length() >= 30);
        String responseJson = data.toString();

        // 缓存结果
        categoryCacheMap.put(cacheKey, responseJson);
        categoryCacheTimeMap.put(cacheKey, now);

        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", responseJson);
    }

    private void sortByYear(JSONArray arr) {
        try {
            List<JSONObject> list = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) list.add(arr.getJSONObject(i));
            Collections.sort(list, (a, b) -> b.optInt("vod_year", 0) - a.optInt("vod_year", 0));
            for (int i = 0; i < list.size(); i++) arr.put(i, list.get(i));
        } catch (Exception e) {}
    }

    private Response apiVideoList(int sourceId, int pg, String t, String wd) throws Exception {
        JSONObject source = findSource(sourceId);
        if (source == null) source = sources.getJSONObject(0);
        String url = source.optString("api_url", source.optString("url", "")) + "?ac=detail&pg=" + pg;
        if (t != null && !t.isEmpty()) url += "&t=" + t;
        if (wd != null && !wd.isEmpty()) url += "&wd=" + URLEncoder.encode(wd, "UTF-8");
        String json = fetchUrl(url);
        JSONObject data = new JSONObject(json);
        JSONArray list = data.optJSONArray("list");
        if (list != null) {
            for (int i = 0; i < list.length(); i++) list.getJSONObject(i).put("source_id", source.optInt("id", 0)).put("source_name", source.optString("name", ""));
            sortByYear(list);
        }
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", data.toString());
    }

    private Response apiVideoDetail(int sourceId, int ids) throws Exception {
        JSONArray results = new JSONArray();
        JSONArray allSources = getAllSources();
        List<Future<JSONArray>> futures = new ArrayList<>();
        for (int i = 0; i < allSources.length(); i++) {
            JSONObject src = allSources.getJSONObject(i);
            final int sid = src.optInt("id", 0); final String sn = src.optString("name", ""); final String su = src.optString("api_url", src.optString("url", ""));
            futures.add(executor.submit(() -> { try { return parseList(fetchUrl(su + "?ac=detail&ids=" + ids), sid, sn, false); } catch (Exception e) { return new JSONArray(); } }));
        }
        for (Future<JSONArray> f : futures) { try { appendToArray(results, f.get(20, TimeUnit.SECONDS)); } catch (Exception e) {} }
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", new JSONObject().put("list", results).toString());
    }

    // ========== 优化5: apiSearch使用CompletionService早返回 ==========
    private static final int SEARCH_MIN_ITEMS = 30; // 搜索收集到30条就返回

    private Response apiSearch(String wd) throws Exception {
        JSONArray results = new JSONArray();
        JSONArray allSources = getAllSources();
        CompletionService<JSONArray> completionService = new ExecutorCompletionService<>(executor);
        List<Future<JSONArray>> futures = new ArrayList<>();

        for (int i = 0; i < allSources.length(); i++) {
            JSONObject src = allSources.getJSONObject(i);
            final int sid = src.optInt("id", 0);
            final String sn = src.optString("name", "");
            final String su = src.optString("api_url", src.optString("url", ""));
            Future<JSONArray> f = completionService.submit(() -> {
                try { return parseList(fetchUrl(su + "?ac=detail&wd=" + URLEncoder.encode(wd, "UTF-8")), sid, sn, false); }
                catch (Exception e) { return new JSONArray(); }
            });
            futures.add(f);
        }

        // 使用CompletionService实现早返回
        int completedCount = 0;
        int totalFutures = futures.size();

        while (completedCount < totalFutures) {
            try {
                Future<JSONArray> future = completionService.poll(FUTURE_GET_TIMEOUT, TimeUnit.SECONDS);
                if (future == null) {
                    // 超时了，但已经收集了足够数据，可以提前退出
                    Log.d(TAG, "apiSearch: timeout, collected " + results.length() + " items");
                    break;
                }
                JSONArray result = future.get();
                appendToArray(results, result);
                completedCount++;

                // 如果已经收集到足够数据，可以提前退出
                if (results.length() >= SEARCH_MIN_ITEMS) {
                    Log.d(TAG, "apiSearch: collected enough items (" + results.length() + "), early return");
                    // 取消剩余未完成的请求
                    for (Future<JSONArray> f : futures) {
                        if (!f.isDone()) f.cancel(false);
                    }
                    break;
                }
            } catch (InterruptedException e) {
                break;
            } catch (ExecutionException e) {
                completedCount++;
            }
        }

        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", new JSONObject().put("list", results).put("total", results.length()).toString());
    }

    /**
     * 按单个源URL搜索 - 前端逐源搜索用
     */
    private Response apiSearchSource(String sourceUrl, String wd) throws Exception {
        JSONArray results = new JSONArray();
        if (sourceUrl.isEmpty() || wd.isEmpty()) {
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", 
                new JSONObject().put("list", results).toString());
        }
        try {
            JSONArray allSources = getAllSources();
            int sid = 0; String sn = "";
            for (int i = 0; i < allSources.length(); i++) {
                JSONObject src = allSources.getJSONObject(i);
                String su = src.optString("api_url", src.optString("url", ""));
                if (su.equals(sourceUrl)) {
                    sid = src.optInt("id", 0);
                    sn = src.optString("name", "");
                    break;
                }
            }
            String json = fetchUrl(sourceUrl + "?ac=detail&wd=" + URLEncoder.encode(wd, "UTF-8"));
            results = parseList(json, sid, sn, false); // 搜索结果需要保留完整字段
        } catch (Exception e) {
            Log.d(TAG, "apiSearchSource error: " + e.getMessage());
        }
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", 
            new JSONObject().put("list", results).put("total", results.length()).toString());
    }

    /**
     * 按源URL获取视频详情 - 搜索结果点击时使用
     * 解决前端直接fetch外部URL被CORS拦截的问题
     */
    private Response apiVideoDetailByUrl(String sourceUrl, String ids) throws Exception {
        JSONArray results = new JSONArray();
        if (sourceUrl.isEmpty() || ids.equals("0")) {
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8",
                new JSONObject().put("list", results).toString());
        }
        try {
            JSONArray allSources = getAllSources();
            int sid = 0; String sn = "";
            for (int i = 0; i < allSources.length(); i++) {
                JSONObject src = allSources.getJSONObject(i);
                String su = src.optString("api_url", src.optString("url", ""));
                if (su.equals(sourceUrl)) {
                    sid = src.optInt("id", 0);
                    sn = src.optString("name", "");
                    break;
                }
            }
            String json = fetchUrl(sourceUrl + "?ac=detail&ids=" + ids);
            results = parseList(json, sid, sn, false); // 详情不过滤大字段，保留完整数据
        } catch (Exception e) {
            Log.d(TAG, "apiVideoDetailByUrl error: " + e.getMessage());
        }
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8",
            new JSONObject().put("list", results).toString());
    }

    /**
     * 直播源代理 - 前端无法直接fetch外部URL（CORS），由后端代理获取直播源内容
     */
    private Response apiLiveFetch(String url) throws Exception {
        if (url == null || url.isEmpty()) {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain; charset=utf-8", "Missing url parameter");
        }
        String content = fetchUrlWithEncoding(url);
        // 判断内容类型，返回合适的 Content-Type（全部加charset=utf-8）
        String contentType = "text/plain; charset=utf-8";
        String trimmed = content.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            contentType = "application/json; charset=utf-8";
        } else if (trimmed.contains("#EXTM3U")) {
            contentType = "application/x-mpegurl; charset=utf-8";
        }
        return newFixedLengthResponse(Response.Status.OK, contentType, content);
    }

    /** 带编码检测的URL获取：先试UTF-8，如果检测到乱码则用GBK重新解码 */
    private String fetchUrlWithEncoding(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("User-Agent", USER_AGENT);
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        int code = conn.getResponseCode();
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (is == null) return "{}";
        // 先读取原始字节
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int len;
        while ((len = is.read(buffer)) != -1) bos.write(buffer, 0, len);
        is.close();
        conn.disconnect();
        byte[] bytes = bos.toByteArray();
        // 先用UTF-8解码
        String utf8 = new String(bytes, "UTF-8");
        // 检测是否有乱码（Unicode替换字符 U+FFFD）
        if (utf8.indexOf('\uFFFD') >= 0) {
            // 可能是GBK编码，尝试用GBK重新解码
            String gbk = new String(bytes, "GBK");
            if (gbk.indexOf('\uFFFD') < 0) return gbk;
        }
        return utf8;
    }

    private JSONObject findSource(int id) {
        JSONArray allSources = getAllSources();
        for (int i = 0; i < allSources.length(); i++) { try { if (allSources.getJSONObject(i).optInt("id", 0) == id) return allSources.getJSONObject(i); } catch (Exception e) {} }
        return null;
    }

    private JSONArray parseList(String json, int sourceId, String sourceName) {
        return parseList(json, sourceId, sourceName, true);
    }

    private JSONArray parseList(String json, int sourceId, String sourceName, boolean stripLargeFields) {
        try {
            JSONArray list = new JSONObject(json).optJSONArray("list");
            if (list == null) return new JSONArray();
            for (int i = 0; i < list.length(); i++) {
                JSONObject v = list.getJSONObject(i);
                v.put("source_id", sourceId).put("source_name", sourceName);
                if (stripLargeFields) {
                    v.remove("vod_play_url");
                    v.remove("vod_play_from");
                    v.remove("vod_content");
                    v.remove("vod_play_note");
                    v.remove("vod_down_url");
                    v.remove("vod_down_from");
                    v.remove("vod_excerpt");
                }
            }
            return list;
        } catch (Exception e) { return new JSONArray(); }
    }

    // ========== 优化6: 大幅降低超时时间 ==========
    private String fetchUrl(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("User-Agent", USER_AGENT);
        // 连接超时5秒，读取超时10秒（原15秒/30秒）
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        int code = conn.getResponseCode();
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (is == null) return "{}";
        BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder sb = new StringBuilder(); String l;
        while ((l = r.readLine()) != null) sb.append(l);
        r.close(); conn.disconnect();
        return sb.toString();
    }

    private Response serveStatic(String uri) {
        try {
            String path = uri.equals("/") ? "index.html" : uri.substring(1);
            InputStream is = context.getAssets().open(path);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096]; int n;
            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
            is.close();
            Response resp = newFixedLengthResponse(Response.Status.OK, getMimeType(path), new ByteArrayInputStream(bos.toByteArray()), bos.size());
            resp.addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            return resp;
        } catch (Exception e) {
            try {
                InputStream is = context.getAssets().open("index.html");
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[4096]; int n;
                while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
                is.close();
                return newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", new ByteArrayInputStream(bos.toByteArray()), bos.size());
            } catch (Exception ex) { return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not Found"); }
        }
    }

    private String getMimeType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg")) return "image/jpeg";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    // ========== 热搜词：爬豆瓣正在热映 ==========
    private String hotKeywordsCache = null;
    private long hotKeywordsTime = 0;
    private static final long HOT_CACHE_MS = 24 * 60 * 60 * 1000; // 缓存24小时

    private Response apiHotKeywords() {
        try {
            long now = System.currentTimeMillis();
            if (hotKeywordsCache != null && (now - hotKeywordsTime) < HOT_CACHE_MS) {
                return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", hotKeywordsCache);
            }
            JSONArray keywords = new JSONArray();
            // 爬豆瓣正在热映
            try {
                String html = fetchUrl("https://movie.douban.com/cinema/nowplaying/");
                // 解析 <li class="list-item" data-title="xxx"
                java.util.regex.Pattern p = java.util.regex.Pattern.compile("data-title=\"([^\"]+)\"");
                java.util.regex.Matcher m = p.matcher(html);
                int count = 0;
                while (m.find() && count < 10) {
                    String title = m.group(1).trim();
                    if (!title.isEmpty() && !title.equals("暂无电影")) {
                        keywords.put(title);
                        count++;
                    }
                }
            } catch (Exception e) {
                Log.d(TAG, "apiHotKeywords douban error: " + e.getMessage());
            }
            // 豆瓣没拿到就试百度热搜
            if (keywords.length() == 0) {
                try {
                    String html = fetchUrl("https://top.baidu.com/board?tab=movie");
                    java.util.regex.Pattern p = java.util.regex.Pattern.compile("class=\"c-single-text-ellipsis\"[^>]*>([^<]+)<");
                    java.util.regex.Matcher m = p.matcher(html);
                    int count = 0;
                    while (m.find() && count < 10) {
                        String title = m.group(1).trim();
                        if (!title.isEmpty()) {
                            keywords.put(title);
                            count++;
                        }
                    }
                } catch (Exception e) {
                    Log.d(TAG, "apiHotKeywords baidu error: " + e.getMessage());
                }
            }
            // 都没拿到用默认词
            if (keywords.length() == 0) {
                String[] defaults = {"哪吒之魔童闹海","封神第二部","庆余年3","长相思2","与凤行","玫瑰的故事","墨雨云间","度华年","繁花","我是刑警"};
                for (String s : defaults) keywords.put(s);
            }
            hotKeywordsCache = new JSONObject().put("keywords", keywords).toString();
            hotKeywordsTime = now;
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", hotKeywordsCache);
        } catch (Exception e) {
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", "{\"keywords\":[]}");
        }
    }

    // ========== 豆瓣API实现 ==========

    /**
     * 豆瓣首页推荐 - 并发请求多个标签整合返回
     */
    private Response apiDoubanHome() throws Exception {
        String cacheKey = "douban_home";
        long now = System.currentTimeMillis();
        Long cacheTime = doubanCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < DOUBAN_CACHE_TTL) {
            String cached = doubanCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        // 定义各板块
        String[][] sectionDefs = {
            {"热门推荐", "热门", "movie"},
            {"华语剧集", "国产剧", "tv"},
            {"美剧", "美剧", "tv"},
            {"韩剧", "韩剧", "tv"},
            {"日本剧集", "日剧", "tv"},
            {"国产电影", "华语", "movie"},
            {"欧美电影", "欧美", "movie"},
            {"豆瓣高分", "豆瓣高分", "movie"},
            {"动漫", "日本动画", "tv"},
            {"综艺", "综艺", "tv"},
        };

        CompletionService<JSONObject> completionService = new ExecutorCompletionService<>(executor);
        List<Future<JSONObject>> futures = new ArrayList<>();

        for (String[] def : sectionDefs) {
            final String name = def[0], tag = def[1], type = def[2];
            final int limit = name.equals("热门推荐") ? 20 : 6;
            futures.add(completionService.submit(() -> {
                JSONObject section = new JSONObject();
                try {
                    section.put("name", name);
                    section.put("tag", tag);
                    section.put("type", type);
                    section.put("items", fetchDoubanSection(tag, type, limit));
                } catch (Exception e) {
                    section.put("name", name);
                    section.put("tag", tag);
                    section.put("type", type);
                    section.put("items", new JSONArray());
                }
                return section;
            }));
        }

        JSONArray sections = new JSONArray();
        JSONArray bannerItems = new JSONArray();
        int completed = 0;
        while (completed < futures.size()) {
            Future<JSONObject> f = completionService.poll(10, TimeUnit.SECONDS);
            if (f == null) break;
            try {
                JSONObject section = f.get();
                sections.put(section);
                if (section.optString("tag").equals("热门") && section.has("items")) {
                    JSONArray items = section.optJSONArray("items");
                    for (int i = 0; i < Math.min(5, items.length()); i++) {
                        bannerItems.put(items.get(i));
                    }
                }
                completed++;
            } catch (Exception e) { completed++; }
        }

        JSONObject result = new JSONObject();
        result.put("banner", bannerItems);
        result.put("sections", sections);

        String json = result.toString();
        doubanCacheMap.put(cacheKey, json);
        doubanCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * 获取豆瓣单个板块数据
     */
    private JSONArray fetchDoubanSection(String tag, String type, int limit) {
        JSONArray arr = new JSONArray();
        try {
            String url = String.format("https://movie.douban.com/j/search_subjects?type=%s&tag=%s&page_start=0&page_limit=%d",
                URLEncoder.encode(type, "UTF-8"), URLEncoder.encode(tag, "UTF-8"), limit);
            String body = fetchDoubanUrl(url);
            JSONObject resp = new JSONObject(body);
            JSONArray subjects = resp.optJSONArray("subjects");
            if (subjects != null) {
                for (int i = 0; i < subjects.length(); i++) {
                    JSONObject s = subjects.getJSONObject(i);
                    JSONObject item = new JSONObject();
                    item.put("title", s.optString("title"));
                    item.put("rate", s.optString("rate"));
                    item.put("cover", s.optString("cover"));
                    item.put("id", s.optString("id"));
                    item.put("url", s.optString("url"));
                    item.put("date", s.optString("date"));
                    item.put("actors", s.optString("actors"));
                    item.put("directors", s.optString("directors"));
                    item.put("is_new", s.optBoolean("is_new"));
                    item.put("vod_type", type);
                    item.put("vod_tag", tag);
                    arr.put(item);
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "fetchDoubanSection error: " + e.getMessage());
        }
        return arr;
    }

    /**
     * 豆瓣影片列表 API
     */
    private Response apiDoubanSubjects(Map<String, String> params) throws Exception {
        String type = params.getOrDefault("type", "movie");
        String tag = params.getOrDefault("tag", "热门");
        String pageStart = params.getOrDefault("page_start", "0");
        String pageLimit = params.getOrDefault("page_limit", "20");

        String cacheKey = String.format("subjects_%s_%s_%s_%s", type, tag, pageStart, pageLimit);
        long now = System.currentTimeMillis();
        Long cacheTime = doubanCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < DOUBAN_CACHE_TTL) {
            String cached = doubanCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        String url = String.format("https://movie.douban.com/j/search_subjects?type=%s&tag=%s&page_start=%s&page_limit=%s",
            URLEncoder.encode(type, "UTF-8"), URLEncoder.encode(tag, "UTF-8"), pageStart, pageLimit);

        String body = fetchDoubanUrl(url);
        JSONObject resp = new JSONObject(body);
        JSONArray subjects = resp.optJSONArray("subjects");
        int total = resp.optInt("total", 0);

        JSONArray items = new JSONArray();
        if (subjects != null) {
            for (int i = 0; i < subjects.length(); i++) {
                JSONObject s = subjects.getJSONObject(i);
                JSONObject item = new JSONObject();
                item.put("title", s.optString("title"));
                item.put("rate", s.optString("rate"));
                item.put("cover", s.optString("cover"));
                item.put("id", s.optString("id"));
                item.put("url", s.optString("url"));
                item.put("date", s.optString("date"));
                item.put("actors", s.optString("actors"));
                item.put("directors", s.optString("directors"));
                item.put("is_new", s.optBoolean("is_new"));
                item.put("vod_type", type);
                item.put("vod_tag", tag);
                items.put(item);
            }
        }

        JSONObject result = new JSONObject();
        result.put("list", items);
        result.put("total", total);
        result.put("hasMore", total > 0);

        String json = result.toString();
        doubanCacheMap.put(cacheKey, json);
        doubanCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * 豆瓣标签列表 API
     */
    private Response apiDoubanTags(Map<String, String> params) throws Exception {
        String type = params.getOrDefault("type", "movie");

        String cacheKey = "tags_" + type;
        long now = System.currentTimeMillis();
        Long cacheTime = doubanCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < DOUBAN_CACHE_TTL) {
            String cached = doubanCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        String url = String.format("https://movie.douban.com/j/search_tags?type=%s&source=index",
            URLEncoder.encode(type, "UTF-8"));

        String body = fetchDoubanUrl(url);

        // 解析响应
        JSONArray tagsArray = new JSONArray();
        try {
            JSONObject resp = new JSONObject(body);
            JSONArray tags = resp.optJSONArray("tags");
            if (tags != null) {
                for (int i = 0; i < tags.length(); i++) {
                    Object t = tags.get(i);
                    if (t instanceof String) {
                        tagsArray.put(t);
                    } else if (t instanceof JSONObject) {
                        tagsArray.put(((JSONObject) t).optString("name"));
                    }
                }
            }
        } catch (Exception e) {
            // 尝试简单解析 {"tags":["tag1","tag2",...]}
            try {
                JSONObject simple = new JSONObject(body);
                tagsArray = simple.optJSONArray("tags");
                if (tagsArray == null) tagsArray = new JSONArray();
            } catch (Exception ex) {}
        }

        JSONObject result = new JSONObject();
        result.put("tags", tagsArray);

        String json = result.toString();
        doubanCacheMap.put(cacheKey, json);
        doubanCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * 豆瓣详情 API - 解析HTML页面
     */
    private Response apiDoubanDetail(Map<String, String> params) throws Exception {
        String id = params.getOrDefault("id", "");
        if (id.isEmpty()) {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Missing id");
        }

        String cacheKey = "detail_" + id;
        long now = System.currentTimeMillis();
        Long cacheTime = doubanCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < DOUBAN_CACHE_TTL) {
            String cached = doubanCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        // 优先用wmdb.tv第三方API（聚合豆瓣+IMDB数据，稳定可用）
        JSONObject result = null;
        try {
            String wmdbUrl = String.format("https://api.wmdb.tv/movie/api?id=%s", id);
            String wmdbBody = fetchDoubanUrl(wmdbUrl);
            result = parseWmdbDetail(wmdbBody, id);
        } catch (Exception e) {
            Log.d(TAG, "wmdb API failed: " + e.getMessage());
        }

        // fallback1: frodo移动端API
        if (result == null || result.optString("title").isEmpty()) {
            try {
                String frodoUrl = String.format("https://frodo.douban.com/api/v2/movie/%s?apiKey=0ac44ae016490db2204ce0a042db2916", id);
                String frodoBody = fetchDoubanUrl(frodoUrl);
                result = parseFrodoDetail(frodoBody, id);
            } catch (Exception e) {
                Log.d(TAG, "frodo API failed: " + e.getMessage());
            }
        }

        // fallback2: 爬HTML
        if (result == null || result.optString("title").isEmpty()) {
            String url = String.format("https://movie.douban.com/subject/%s/", id);
            String html = fetchDoubanUrl(url);
            result = parseDoubanDetailHTML(html, id);
        }

        String json = result.toString();
        doubanCacheMap.put(cacheKey, json);
        doubanCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * 解析wmdb.tv第三方API返回的JSON（聚合豆瓣+IMDB数据）
     */
    private JSONObject parseWmdbDetail(String body, String id) {
        JSONObject result = new JSONObject();
        try {
            JSONObject data = new JSONObject(body);
            result.put("code", 200);
            result.put("id", id);
            
            // 从data数组中取中文数据
            String title = "";
            String cover = "";
            String genre = "";
            String description = "";
            String language = "";
            String country = "";
            JSONArray dataArray = data.optJSONArray("data");
            if (dataArray != null && dataArray.length() > 0) {
                // 优先取中文数据
                JSONObject cnData = null;
                JSONObject firstData = dataArray.getJSONObject(0);
                for (int i = 0; i < dataArray.length(); i++) {
                    JSONObject d = dataArray.getJSONObject(i);
                    if ("Cn".equals(d.optString("lang", ""))) {
                        cnData = d;
                        break;
                    }
                }
                if (cnData == null) cnData = firstData;
                title = cnData.optString("name", "");
                cover = cnData.optString("poster", "");
                genre = cnData.optString("genre", "");
                description = cnData.optString("description", "");
                language = cnData.optString("language", "");
                country = cnData.optString("country", "");
            }
            
            result.put("title", title);
            result.put("year", data.optString("year", ""));
            result.put("cover", cover);
            
            // 评分（豆瓣评分+IMDB评分）
            String doubanRating = data.optString("doubanRating", "");
            String imdbRating = data.optString("imdbRating", "");
            if (!doubanRating.isEmpty() && !"0".equals(doubanRating)) {
                result.put("rate", doubanRating);
            } else if (!imdbRating.isEmpty()) {
                result.put("rate", imdbRating);
            } else {
                result.put("rate", "");
            }
            String doubanVotes = data.optString("doubanVotes", "0");
            result.put("rating_count", doubanVotes);
            
            // 地区/语言
            result.put("region", country);
            result.put("language", language);
            
            // 又名
            String alias = data.optString("alias", "");
            JSONArray aka = new JSONArray();
            if (!alias.isEmpty()) {
                String[] aliasParts = alias.split(" / ");
                for (String a : aliasParts) {
                    String trimmed = a.trim();
                    if (!trimmed.isEmpty()) aka.put(trimmed);
                }
            }
            result.put("aka", aka);
            
            // 上映日期
            String dateReleased = data.optString("dateReleased", "");
            result.put("pubdate", dateReleased);
            
            // 片长（wmdb返回的是秒数，转为分钟）
            int durationSec = data.optInt("duration", 0);
            if (durationSec > 0) {
                int durationMin = durationSec / 60;
                result.put("durations", durationMin + "分钟");
            } else {
                result.put("durations", "");
            }
            
            // 类型
            JSONArray gArr = new JSONArray();
            if (!genre.isEmpty()) {
                String[] genres = genre.split("/");
                for (String g : genres) {
                    String trimmed = g.trim();
                    if (!trimmed.isEmpty()) gArr.put(trimmed);
                }
            }
            result.put("genres", gArr);
            result.put("types", genre);
            
            // 导演
            JSONArray directorArr = data.optJSONArray("director");
            JSONArray dArr = new JSONArray();
            if (directorArr != null) {
                for (int i = 0; i < directorArr.length(); i++) {
                    JSONObject dirGroup = directorArr.getJSONObject(i);
                    JSONArray dirData = dirGroup.optJSONArray("data");
                    if (dirData != null) {
                        for (int j = 0; j < dirData.length(); j++) {
                            JSONObject d = dirData.getJSONObject(j);
                            if ("Cn".equals(d.optString("lang", ""))) {
                                dArr.put(d.optString("name", ""));
                                break;
                            }
                        }
                    }
                }
            }
            result.put("directors", dArr);
            
            // 演员
            JSONArray actorArr = data.optJSONArray("actor");
            JSONArray aArr = new JSONArray();
            if (actorArr != null) {
                for (int i = 0; i < Math.min(actorArr.length(), 20); i++) {
                    JSONObject actGroup = actorArr.getJSONObject(i);
                    JSONArray actData = actGroup.optJSONArray("data");
                    if (actData != null) {
                        for (int j = 0; j < actData.length(); j++) {
                            JSONObject a = actData.getJSONObject(j);
                            if ("Cn".equals(a.optString("lang", ""))) {
                                JSONObject actor = new JSONObject();
                                actor.put("name", a.optString("name", ""));
                                actor.put("role", "");
                                aArr.put(actor);
                                break;
                            }
                        }
                    }
                }
            }
            result.put("actors", aArr);
            
            // 简介
            result.put("summary", description);
            
            // 集数
            result.put("episodes", data.optInt("episodes", 0));
            
            // 原始名
            result.put("originalName", data.optString("originalName", ""));
            
        } catch (Exception e) {
            Log.d(TAG, "parseWmdbDetail error: " + e.getMessage());
            return null;
        }
        return result;
    }

    /**
     * 解析豆瓣frodo移动端API返回的JSON
     */
    private JSONObject parseFrodoDetail(String body, String id) {
        JSONObject result = new JSONObject();
        try {
            JSONObject data = new JSONObject(body);
            result.put("code", 200);
            result.put("id", id);
            
            // 基本信息
            result.put("title", data.optString("title", ""));
            result.put("year", data.optString("year", ""));
            result.put("cover", data.optString("pic", null) != null ? data.optString("pic", "") : data.optJSONObject("cover") != null ? data.getJSONObject("cover").optString("url", "") : "");
            
            // 评分
            JSONObject rating = data.optJSONObject("rating");
            if (rating != null) {
                String rate = rating.optString("value", "");
                if (!rate.isEmpty() && !rate.equals("0")) {
                    result.put("rate", rate);
                } else {
                    result.put("rate", "");
                }
                result.put("rating_count", rating.optString("count", ""));
            } else {
                result.put("rate", "");
                result.put("rating_count", "");
            }
            
            // 地区/语言
            result.put("region", "");
            result.put("language", "");
            JSONArray countries = data.optJSONArray("countries");
            if (countries != null && countries.length() > 0) {
                result.put("region", countries.join(" / ").replace("\"", ""));
            }
            JSONArray languages = data.optJSONArray("languages");
            if (languages != null && languages.length() > 0) {
                result.put("language", languages.join(" / ").replace("\"", ""));
            }
            
            // 又名
            JSONArray akaArr = data.optJSONArray("aka");
            JSONArray aka = new JSONArray();
            if (akaArr != null) {
                for (int i = 0; i < akaArr.length(); i++) aka.put(akaArr.getString(i));
            }
            result.put("aka", aka);
            
            // 上映日期
            JSONArray pubdates = data.optJSONArray("pubdates");
            if (pubdates != null && pubdates.length() > 0) {
                result.put("pubdate", pubdates.getString(0));
            } else {
                result.put("pubdate", "");
            }
            
            // 片长
            JSONArray durations = data.optJSONArray("durations");
            if (durations != null && durations.length() > 0) {
                result.put("durations", durations.getString(0));
            } else {
                result.put("durations", "");
            }
            
            // 类型
            JSONArray genres = data.optJSONArray("genres");
            JSONArray gArr = new JSONArray();
            if (genres != null) {
                for (int i = 0; i < genres.length(); i++) gArr.put(genres.getString(i));
            }
            result.put("genres", gArr);
            result.put("types", gArr.join(","));
            
            // 导演
            JSONArray directors = data.optJSONArray("directors");
            JSONArray dArr = new JSONArray();
            if (directors != null) {
                for (int i = 0; i < directors.length(); i++) {
                    dArr.put(directors.getJSONObject(i).optString("name", ""));
                }
            }
            result.put("directors", dArr);
            
            // 演员
            JSONArray actors = data.optJSONArray("actors");
            JSONArray aArr = new JSONArray();
            if (actors != null) {
                for (int i = 0; i < Math.min(actors.length(), 20); i++) {
                    JSONObject a = actors.getJSONObject(i);
                    JSONObject actor = new JSONObject();
                    actor.put("name", a.optString("name", ""));
                    actor.put("role", a.optString("character", ""));
                    aArr.put(actor);
                }
            }
            result.put("actors", aArr);
            
            // 简介
            result.put("summary", data.optString("intro", ""));
            
            // 集数
            result.put("episodes", data.optInt("episodes_count", 0));
            
        } catch (Exception e) {
            Log.d(TAG, "parseFrodoDetail error: " + e.getMessage());
            return null;
        }
        return result;
    }

    /**
     * 解析豆瓣详情页HTML
     */
    private JSONObject parseDoubanDetailHTML(String html, String id) {
        JSONObject result = new JSONObject();
        try {
            result.put("code", 200);
            result.put("id", id);
            result.put("title", "");
            result.put("rate", "");
            result.put("cover", "");
            result.put("year", "");
            result.put("region", "");
            result.put("language", "");
            result.put("aka", new JSONArray());
            result.put("pubdate", "");
            result.put("durations", "");
            result.put("genres", new JSONArray());
            result.put("directors", new JSONArray());
            result.put("actors", new JSONArray());
            result.put("summary", "");
            result.put("episodes", 0);
            result.put("types", "");
            result.put("rating_count", "");

            // 提取标题
            java.util.regex.Pattern pTitle = java.util.regex.Pattern.compile("<title>([^<]+)</title>");
            java.util.regex.Matcher mTitle = pTitle.matcher(html);
            if (mTitle.find()) {
                String title = mTitle.group(1).trim();
                // 去掉" (豆瓣)"后缀
                int idx1 = title.indexOf(" (豆瓣)");
                if (idx1 > 0) title = title.substring(0, idx1);
                // 去掉" - 豆瓣"后缀
                int idx2 = title.indexOf(" - 豆瓣");
                if (idx2 > 0) title = title.substring(0, idx2);
                result.put("title", title.trim());
            }

            // 提取评分
            java.util.regex.Pattern pRate = java.util.regex.Pattern.compile("<strong class=\"ll rating_num\"[^>]*>([^<]+)</strong>");
            java.util.regex.Matcher mRate = pRate.matcher(html);
            if (mRate.find()) {
                result.put("rate", mRate.group(1).trim());
            }

            // 评分人数
            java.util.regex.Pattern pRatingCount = java.util.regex.Pattern.compile("<span property=\"v:votes\">([^<]+)</span>");
            java.util.regex.Matcher mRatingCount = pRatingCount.matcher(html);
            if (mRatingCount.find()) {
                result.put("rating_count", mRatingCount.group(1).trim());
            }

            // 提取海报
            java.util.regex.Pattern pCover = java.util.regex.Pattern.compile("<img src=\"([^\"]+)\"[^>]*class=\"nbg\"[^>]*>");
            java.util.regex.Matcher mCover = pCover.matcher(html);
            if (mCover.find()) {
                String cover = mCover.group(1).replace("img9", "img1");
                result.put("cover", cover);
            }

            // 提取info区域
            java.util.regex.Pattern pInfo = java.util.regex.Pattern.compile("<div id=\"info\"[^>]*>(.*?)</div>", java.util.regex.Pattern.DOTALL);
            java.util.regex.Matcher mInfo = pInfo.matcher(html);
            if (mInfo.find()) {
                String infoHTML = mInfo.group(1);

                // 年份
                java.util.regex.Pattern pYear = java.util.regex.Pattern.compile("<span[^>]*>(\\d{4})</span>");
                java.util.regex.Matcher mYear = pYear.matcher(infoHTML);
                if (mYear.find()) {
                    result.put("year", mYear.group(1));
                }

                // 地区
                java.util.regex.Pattern pRegion = java.util.regex.Pattern.compile("制片国家/地区[^>]*>([^<]+)");
                java.util.regex.Matcher mRegion = pRegion.matcher(infoHTML);
                if (mRegion.find()) {
                    result.put("region", mRegion.group(1).trim());
                }

                // 语言
                java.util.regex.Pattern pLang = java.util.regex.Pattern.compile("语言[^>]*>([^<]+)");
                java.util.regex.Matcher mLang = pLang.matcher(infoHTML);
                if (mLang.find()) {
                    result.put("language", mLang.group(1).trim());
                }

                // 又名
                java.util.regex.Pattern pAka = java.util.regex.Pattern.compile("又名[^>]*>([^<]+)");
                java.util.regex.Matcher mAka = pAka.matcher(infoHTML);
                JSONArray aka = new JSONArray();
                if (mAka.find()) {
                    String[] akaArr = mAka.group(1).trim().split(" / ");
                    for (String a : akaArr) {
                        if (!a.trim().isEmpty()) aka.put(a.trim());
                    }
                }
                result.put("aka", aka);

                // 上映时间
                java.util.regex.Pattern pPubdate = java.util.regex.Pattern.compile("<span property=\"v:initialReleaseDate\"[^>]*>([^<]+)</span>");
                java.util.regex.Matcher mPubdate = pPubdate.matcher(infoHTML);
                if (mPubdate.find()) {
                    result.put("pubdate", mPubdate.group(1).trim());
                }

                // 片长
                java.util.regex.Pattern pDur = java.util.regex.Pattern.compile("<span property=\"v:runtime\"[^>]*>([^<]+)</span>");
                java.util.regex.Matcher mDur = pDur.matcher(infoHTML);
                if (mDur.find()) {
                    result.put("durations", mDur.group(1).trim());
                }

                // 类型/genre
                java.util.regex.Pattern pGenre = java.util.regex.Pattern.compile("<span property=\"v:genre\">([^<]+)</span>");
                java.util.regex.Matcher mGenre = pGenre.matcher(infoHTML);
                JSONArray genres = new JSONArray();
                StringBuilder types = new StringBuilder();
                while (mGenre.find()) {
                    genres.put(mGenre.group(1).trim());
                    if (types.length() > 0) types.append(",");
                    types.append(mGenre.group(1).trim());
                }
                result.put("genres", genres);
                result.put("types", types.toString());

                // 导演
                java.util.regex.Pattern pDir = java.util.regex.Pattern.compile("<a href=\"[^\"]*\" rel=\"v:directedBy\">([^<]+)</a>");
                java.util.regex.Matcher mDir = pDir.matcher(infoHTML);
                JSONArray directors = new JSONArray();
                while (mDir.find()) {
                    directors.put(mDir.group(1).trim());
                }
                result.put("directors", directors);

                // 集数
                java.util.regex.Pattern pEp = java.util.regex.Pattern.compile("<span property=\"v:episodes\">(\\d+)</span>");
                java.util.regex.Matcher mEp = pEp.matcher(infoHTML);
                if (mEp.find()) {
                    result.put("episodes", Integer.parseInt(mEp.group(1)));
                }
            }

            // 提取演员
            java.util.regex.Pattern pActor = java.util.regex.Pattern.compile("<a href=\"[^\"]*\" class=\"[^\"]*\" rel=\"v:starring\">([^<]+)</a>");
            java.util.regex.Matcher mActor = pActor.matcher(html);
            JSONArray actors = new JSONArray();
            int actorCount = 0;
            while (mActor.find() && actorCount < 20) {
                JSONObject actor = new JSONObject();
                actor.put("name", mActor.group(1).trim());
                actor.put("role", "");
                actors.put(actor);
                actorCount++;
            }
            result.put("actors", actors);

            // 提取简介
            java.util.regex.Pattern pSummary = java.util.regex.Pattern.compile("<span class=\"all hidden\">([^<]+)</span>");
            java.util.regex.Matcher mSummary = pSummary.matcher(html);
            if (mSummary.find()) {
                String summary = mSummary.group(1).trim().replace("<br>", "\n").replaceAll("<[^>]+>", "");
                result.put("summary", summary);
            } else {
                java.util.regex.Pattern pShort = java.util.regex.Pattern.compile("<span class=\"short\">([^<]+)</span>");
                java.util.regex.Matcher mShort = pShort.matcher(html);
                if (mShort.find()) {
                    String summary = mShort.group(1).trim().replaceAll("<[^>]+>", "");
                    result.put("summary", summary);
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "parseDoubanDetailHTML error: " + e.getMessage());
        }
        return result;
    }

    /**
     * 豆瓣搜索 API
     */
    private Response apiDoubanSearch(Map<String, String> params) throws Exception {
        String query = params.getOrDefault("q", "");
        if (query.isEmpty()) {
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", "{\"subjects\":[],\"total\":0}");
        }

        String cacheKey = "search_" + URLEncoder.encode(query, "UTF-8");
        long now = System.currentTimeMillis();
        Long cacheTime = doubanCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < DOUBAN_CACHE_TTL) {
            String cached = doubanCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        String url = String.format("https://movie.douban.com/subjects?search_text=%s", URLEncoder.encode(query, "UTF-8"));
        String html = fetchDoubanUrl(url);

        JSONArray items = parseDoubanSearchHTML(html);
        JSONObject result = new JSONObject();
        result.put("subjects", items);
        result.put("total", items.length());

        String json = result.toString();
        doubanCacheMap.put(cacheKey, json);
        doubanCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * 解析豆瓣搜索结果HTML
     */
    private JSONArray parseDoubanSearchHTML(String html) {
        JSONArray items = new JSONArray();
        try {
            java.util.regex.Pattern pItem = java.util.regex.Pattern.compile("<div class=\"item\">.*?<div class=\"info\">(.*?)</div>.*?</div>", java.util.regex.Pattern.DOTALL);
            java.util.regex.Matcher mItem = pItem.matcher(html);

            while (mItem.find()) {
                String infoHTML = mItem.group(1);
                JSONObject item = new JSONObject();

                // 提取标题和链接
                java.util.regex.Pattern pTitle = java.util.regex.Pattern.compile("<a href=\"/subject/(\\d+)/[^\"]*\"[^>]*>\\s*<img src=\"([^\"]+)\"[^>]*>\\s*</a>\\s*<div class=\"hd\">\\s*<a class=\"\" href=\"/subject/(\\d+)/[^\"]*\"[^>]*>([^<]+)</a>");
                java.util.regex.Matcher mTitle = pTitle.matcher(infoHTML);
                if (mTitle.find()) {
                    item.put("id", mTitle.group(1));
                    item.put("cover", mTitle.group(2));
                    item.put("url", "https://movie.douban.com/subject/" + mTitle.group(1) + "/");
                    String title = mTitle.group(4).replaceAll("<[^>]+>", "").trim();
                    item.put("title", title);
                }

                // 提取评分
                java.util.regex.Pattern pRate = java.util.regex.Pattern.compile("<span class=\"rating_nums\">([^<]+)</span>");
                java.util.regex.Matcher mRate = pRate.matcher(infoHTML);
                if (mRate.find()) {
                    item.put("rate", mRate.group(1).trim());
                }

                // 提取meta信息
                java.util.regex.Pattern pMeta = java.util.regex.Pattern.compile("<span class=\"meta\">([^<]+)</span>");
                java.util.regex.Matcher mMeta = pMeta.matcher(infoHTML);
                while (mMeta.find()) {
                    String meta = mMeta.group(1).trim();
                    if (meta.matches("^\\d{4}")) {
                        if (!item.has("year")) item.put("year", meta);
                    }
                }

                if (item.has("title") && !item.optString("title").isEmpty()) {
                    items.put(item);
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "parseDoubanSearchHTML error: " + e.getMessage());
        }
        return items;
    }

    /**
     * 搜索建议 - 优先用wmdb.tv搜索，fallback到豆瓣suggest
     */
    private Response apiDoubanSuggest(Map<String, String> params) throws Exception {
        String query = params.getOrDefault("q", "");
        if (query.isEmpty()) {
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", "{\"subjects\":[],\"total\":0}");
        }

        String cacheKey = "suggest_" + URLEncoder.encode(query, "UTF-8");
        long now = System.currentTimeMillis();
        Long cacheTime = doubanCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < DOUBAN_CACHE_TTL) {
            String cached = doubanCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        JSONArray items = new JSONArray();
        
        // 优先用wmdb.tv搜索
        try {
            String wmdbUrl = String.format("https://api.wmdb.tv/api/v1/movie/search?q=%s&limit=5&lang=Cn", URLEncoder.encode(query, "UTF-8"));
            String body = fetchDoubanUrl(wmdbUrl);
            JSONObject resp = new JSONObject(body);
            JSONArray dataArray = resp.optJSONArray("data");
            if (dataArray != null) {
                for (int i = 0; i < dataArray.length(); i++) {
                    JSONObject d = dataArray.getJSONObject(i);
                    JSONObject item = new JSONObject();
                    item.put("id", d.optString("doubanId", ""));
                    // 优先用原始名匹配，同时保存别名用于模糊匹配
                    String alias = d.optString("alias", "");
                    item.put("title", d.optString("originalName", ""));
                    item.put("alias", alias);
                    item.put("cover", "");
                    String dr = d.optString("doubanRating", "");
                    item.put("rate", !dr.isEmpty() && !"0".equals(dr) ? dr : "");
                    item.put("type", d.optString("type", "Movie").equals("Movie") ? "movie" : "tv");
                    item.put("year", d.optString("year", ""));
                    if (!item.optString("id").isEmpty() && !item.optString("title").isEmpty()) {
                        items.put(item);
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "wmdb suggest failed: " + e.getMessage());
        }
        
        // fallback: 豆瓣suggestion API
        if (items.length() == 0) {
            try {
                String url = String.format("https://movie.douban.com/j/subject_suggest?q=%s", URLEncoder.encode(query, "UTF-8"));
                String body = fetchDoubanUrl(url);
                JSONArray arr = new JSONArray(body);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject s = arr.getJSONObject(i);
                    JSONObject item = new JSONObject();
                    item.put("id", s.optString("id"));
                    item.put("title", s.optString("title"));
                    item.put("cover", s.optString("img", ""));
                    item.put("rate", s.optString("rate", ""));
                    item.put("type", s.optString("type", "movie"));
                    item.put("year", s.optString("year", ""));
                    if(!item.optString("id").isEmpty() && !item.optString("title").isEmpty()) {
                        items.put(item);
                    }
                }
            } catch (Exception e) {
                Log.d(TAG, "douban suggest fallback failed: " + e.getMessage());
            }
        }

        JSONObject result = new JSONObject();
        result.put("subjects", items);
        result.put("total", items.length());

        String json = result.toString();
        doubanCacheMap.put(cacheKey, json);
        doubanCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * 豆瓣全部分类标签 API
     */
    private Response apiDoubanTagsAll() throws Exception {
        String cacheKey = "tags_all";
        long now = System.currentTimeMillis();
        Long cacheTime = doubanCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < DOUBAN_CACHE_TTL) {
            String cached = doubanCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        JSONObject result = new JSONObject();

        // movie标签
        JSONObject movieTags = new JSONObject();
        movieTags.put("content_type", new JSONArray().put("热门").put("最新").put("经典").put("豆瓣高分").put("冷门佳片"));
        movieTags.put("genre", new JSONArray().put("剧情").put("喜剧").put("动作").put("爱情").put("科幻").put("悬疑").put("恐怖").put("治愈").put("奇幻").put("犯罪").put("动画"));
        movieTags.put("region", new JSONArray().put("华语").put("欧美").put("韩国").put("日本").put("美国").put("英国").put("法国"));
        movieTags.put("sort", new JSONArray().put("热门").put("最新").put("评分"));

        // tv标签
        JSONObject tvTags = new JSONObject();
        tvTags.put("content_type", new JSONArray().put("热门").put("国产剧").put("美剧").put("英剧").put("韩剧").put("日剧").put("港剧"));
        tvTags.put("genre", new JSONArray().put("综艺").put("纪录片").put("日本动画"));
        tvTags.put("region", new JSONArray().put("华语").put("欧美").put("韩国").put("日本"));
        tvTags.put("sort", new JSONArray().put("热门").put("最新").put("评分"));

        result.put("movie", movieTags);
        result.put("tv", tvTags);

        String json = result.toString();
        doubanCacheMap.put(cacheKey, json);
        doubanCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * 带豆瓣请求头的URL获取
     */
    private String fetchDoubanUrl(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("User-Agent", USER_AGENT);
        conn.setRequestProperty("Referer", "https://movie.douban.com/");
        conn.setRequestProperty("Accept", "application/json, text/plain, */*");
        conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
        conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
        // 豆瓣需要bid cookie，随机生成一个
        if(!urlStr.contains("/j/subject_suggest")) {
            conn.setRequestProperty("Cookie", "bid=" + generateBid());
        } else {
            conn.setRequestProperty("Cookie", "bid=" + generateBid() + "; __utma=30149280.1.1.1; __utmb=30149280.1.1.1");
        }
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        conn.setInstanceFollowRedirects(false);
        int code = conn.getResponseCode();
        // 处理302重定向
        if(code == 302 || code == 301) {
            String location = conn.getHeaderField("Location");
            if(location != null) {
                conn.disconnect();
                return fetchDoubanUrl(location);
            }
        }
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (is == null) return "{}";
        BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String l;
        while ((l = r.readLine()) != null) sb.append(l);
        r.close();
        conn.disconnect();
        return sb.toString();
    }

    private String generateBid() {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder();
        java.util.Random rand = new java.util.Random();
        for(int i=0;i<11;i++) sb.append(chars.charAt(rand.nextInt(chars.length())));
        return sb.toString();
    }

    // ==================== TMDB API 方法 ====================

    /**
     * TMDB首页 - 获取热门电影、剧集、动漫等板块
     */
    private Response apiTmdbHome() throws Exception {
        String cacheKey = "tmdb_home";
        long now = System.currentTimeMillis();
        Long cacheTime = tmdbCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < TMDB_CACHE_TTL) {
            String cached = tmdbCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        JSONArray sections = new JSONArray();
        JSONArray bannerItems = new JSONArray();

        // 并行获取各板块数据
        CompletionService<JSONObject> completionService = new ExecutorCompletionService<>(executor);
        List<Future<JSONObject>> futures = new ArrayList<>();

        // 热门电影 - 中文热门电影（去重）
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "热门电影");
                section.put("tag", "popular_movie");
                section.put("type", "movie");
                // 中文 + 2024年至今 + 按投票数排序（质量更好）
                JSONArray arr = fetchTmdbMovies("/discover/movie?with_original_language=zh&primary_release_date.gte=2024-01-01&sort_by=vote_count.desc", 20);
                section.put("items", arr);
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 最新电影 - 中文今年热门
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "最新电影");
                section.put("tag", "latest_movie");
                section.put("type", "movie");
                // 中文 + 2025年至今 + 按投票数排序
                section.put("items", fetchTmdbMovies("/discover/movie?with_original_language=zh&primary_release_date.gte=2025-01-01&sort_by=vote_count.desc", 20));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 华语剧集 - 大陆剧集
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "华语剧集");
                section.put("tag", "chinese_tv");
                section.put("type", "tv");
                // 大陆剧集，2024年至今
                section.put("items", fetchTmdbTv("/discover/tv?with_origin_country=CN&first_air_date.gte=2024-01-01&sort_by=vote_count.desc", 12));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 美剧 - 按投票数排序
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "美剧");
                section.put("tag", "american_tv");
                section.put("type", "tv");
                section.put("items", fetchTmdbTv("/discover/tv?with_original_language=en&first_air_date.gte=2024-01-01&sort_by=vote_count.desc", 12));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 韩剧 - 按投票数排序
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "韩剧");
                section.put("tag", "korean_tv");
                section.put("type", "tv");
                section.put("items", fetchTmdbTv("/discover/tv?with_original_language=ko&first_air_date.gte=2024-01-01&sort_by=vote_count.desc", 12));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 日本剧集 - 按投票数排序
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "日剧");
                section.put("tag", "japanese_tv");
                section.put("type", "tv");
                section.put("items", fetchTmdbTv("/discover/tv?with_original_language=ja&first_air_date.gte=2024-01-01&sort_by=vote_count.desc", 12));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 国产电影 - 按投票数排序
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "国产电影");
                section.put("tag", "chinese_movie");
                section.put("type", "movie");
                section.put("items", fetchTmdbMovies("/discover/movie?with_original_language=zh&primary_release_date.gte=2024-01-01&sort_by=vote_count.desc", 12));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 欧美电影 - 按投票数排序
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "欧美电影");
                section.put("tag", "american_movie");
                section.put("type", "movie");
                section.put("items", fetchTmdbMovies("/discover/movie?with_original_language=en&primary_release_date.gte=2024-01-01&sort_by=vote_count.desc", 12));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 动漫 - 中文动漫
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "动漫");
                section.put("tag", "anime");
                section.put("type", "tv");
                // 中文或日本动漫
                section.put("items", fetchTmdbTv("/discover/tv?with_genres=16&sort_by=vote_count.desc&with_origin_country=CN&first_air_date.gte=2024-01-01", 12));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));
        // 综艺 - 中文综艺
        futures.add(completionService.submit(() -> {
            JSONObject section = new JSONObject();
            try {
                section.put("name", "综艺");
                section.put("tag", "variety");
                section.put("type", "tv");
                // 中文综艺
                section.put("items", fetchTmdbTv("/discover/tv?with_genres=10764&sort_by=vote_count.desc&with_original_language=zh&first_air_date.gte=2024-01-01", 12));
            } catch (Exception e) { section.put("items", new JSONArray()); }
            return section;
        }));

        // 收集结果（带去重）
        int completed = 0;
        Set<Integer> seenIds = new HashSet<>();
        while (completed < futures.size()) {
            Future<JSONObject> f = completionService.poll(10, TimeUnit.SECONDS);
            if (f == null) break;
            try {
                JSONObject section = f.get();
                // 对每个section的items去重
                if (section.has("items")) {
                    JSONArray items = section.optJSONArray("items");
                    JSONArray uniqueItems = new JSONArray();
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.getJSONObject(i);
                        int id = item.optInt("id", 0);
                        if (id > 0 && !seenIds.contains(id)) {
                            seenIds.add(id);
                            uniqueItems.put(item);
                        }
                    }
                    section.put("items", uniqueItems);
                }
                sections.put(section);
                // 热门电影前5条作为Banner（已去重）
                if (section.optString("tag").equals("popular_movie") && section.has("items")) {
                    JSONArray items = section.optJSONArray("items");
                    for (int i = 0; i < Math.min(5, items.length()); i++) {
                        bannerItems.put(items.get(i));
                    }
                }
                completed++;
            } catch (Exception e) { completed++; }
        }

        JSONObject result = new JSONObject();
        result.put("banner", bannerItems);
        result.put("sections", sections);

        String json = result.toString();
        tmdbCacheMap.put(cacheKey, json);
        tmdbCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * 获取TMDB电影列表
     */
    private JSONArray fetchTmdbMovies(String endpoint, int limit) {
        JSONArray arr = new JSONArray();
        try {
            // 兼容endpoint带不带?的情况
            String separator = endpoint.contains("?") ? "&" : "?";
            String url = TMDB_BASE_URL + endpoint + separator + "api_key=" + TMDB_API_KEY + "&page=1&language=zh-CN";
            String body = fetchTmdbUrl(url);
            JSONObject resp = new JSONObject(body);
            JSONArray results = resp.optJSONArray("results");
            if (results != null) {
                for (int i = 0; i < Math.min(limit, results.length()); i++) {
                    JSONObject r = results.getJSONObject(i);
                    JSONObject item = new JSONObject();
                    item.put("id", r.optInt("id"));
                    item.put("title", r.optString("title"));
                    item.put("original_title", r.optString("original_title"));
                    item.put("overview", r.optString("overview"));
                    item.put("poster_path", r.optString("poster_path"));
                    item.put("backdrop_path", r.optString("backdrop_path"));
                    item.put("vote_average", r.optDouble("vote_average", 0));
                    item.put("vote_count", r.optInt("vote_count", 0));
                    item.put("release_date", r.optString("release_date"));
                    item.put("media_type", "movie");
                    String poster = r.optString("poster_path", "");
                    item.put("cover", poster.isEmpty() ? "" : TMDB_IMAGE_BASE + poster);
                    arr.put(item);
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "fetchTmdbMovies error: " + e.getMessage());
        }
        return arr;
    }

    /**
     * 获取TMDB剧集列表
     */
    private JSONArray fetchTmdbTv(String endpoint, int limit) {
        JSONArray arr = new JSONArray();
        try {
            // 兼容endpoint带不带?的情况
            String separator = endpoint.contains("?") ? "&" : "?";
            String url = TMDB_BASE_URL + endpoint + separator + "api_key=" + TMDB_API_KEY + "&page=1&language=zh-CN";
            String body = fetchTmdbUrl(url);
            JSONObject resp = new JSONObject(body);
            JSONArray results = resp.optJSONArray("results");
            if (results != null) {
                for (int i = 0; i < Math.min(limit, results.length()); i++) {
                    JSONObject r = results.getJSONObject(i);
                    JSONObject item = new JSONObject();
                    item.put("id", r.optInt("id"));
                    item.put("title", r.optString("name"));
                    item.put("original_title", r.optString("original_name"));
                    item.put("overview", r.optString("overview"));
                    item.put("poster_path", r.optString("poster_path"));
                    item.put("backdrop_path", r.optString("backdrop_path"));
                    item.put("vote_average", r.optDouble("vote_average", 0));
                    item.put("vote_count", r.optInt("vote_count", 0));
                    item.put("first_air_date", r.optString("first_air_date"));
                    item.put("media_type", "tv");
                    String poster = r.optString("poster_path", "");
                    item.put("cover", poster.isEmpty() ? "" : TMDB_IMAGE_BASE + poster);
                    arr.put(item);
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "fetchTmdbTv error: " + e.getMessage());
        }
        return arr;
    }

    /**
     * TMDB搜索
     */
    private Response apiTmdbSearch(Map<String, String> params) throws Exception {
        String query = params.getOrDefault("q", params.getOrDefault("wd", ""));
        if (query.isEmpty()) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", "{\"results\":[]}");

        String cacheKey = "tmdb_search_" + query;
        long now = System.currentTimeMillis();
        Long cacheTime = tmdbCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < TMDB_CACHE_TTL) {
            String cached = tmdbCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        JSONArray results = new JSONArray();
        try {
            String url = TMDB_BASE_URL + "/search/multi?api_key=" + TMDB_API_KEY + "&query=" + URLEncoder.encode(query, "UTF-8") + "&language=zh-CN&page=1";
            String body = fetchTmdbUrl(url);
            JSONObject resp = new JSONObject(body);
            JSONArray arr = resp.optJSONArray("results");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject r = arr.getJSONObject(i);
                    String mediaType = r.optString("media_type", "");
                    if (!mediaType.equals("movie") && !mediaType.equals("tv")) continue;
                    
                    JSONObject item = new JSONObject();
                    item.put("id", r.optInt("id"));
                    item.put("title", r.optString("title").isEmpty() ? r.optString("name") : r.optString("title"));
                    item.put("overview", r.optString("overview"));
                    item.put("poster_path", r.optString("poster_path"));
                    item.put("vote_average", r.optDouble("vote_average", 0));
                    item.put("media_type", mediaType);
                    String poster = r.optString("poster_path", "");
                    item.put("cover", poster.isEmpty() ? "" : TMDB_IMAGE_BASE + poster);
                    results.put(item);
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "apiTmdbSearch error: " + e.getMessage());
        }

        String json = new JSONObject().put("results", results).toString();
        tmdbCacheMap.put(cacheKey, json);
        tmdbCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * TMDB电影详情
     */
    private Response apiTmdbMoviePopular(Map<String, String> params) throws Exception {
        int page = Integer.parseInt(params.getOrDefault("page", "1"));
        String cacheKey = "tmdb_movie_popular_" + page;
        long now = System.currentTimeMillis();
        Long cacheTime = tmdbCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < TMDB_CACHE_TTL) {
            String cached = tmdbCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        JSONArray results = fetchTmdbMovies("/movie/popular?page=" + page, 20);
        String json = new JSONObject().put("results", results).toString();
        tmdbCacheMap.put(cacheKey, json);
        tmdbCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * TMDB剧集详情
     */
    private Response apiTmdbTvPopular(Map<String, String> params) throws Exception {
        int page = Integer.parseInt(params.getOrDefault("page", "1"));
        String cacheKey = "tmdb_tv_popular_" + page;
        long now = System.currentTimeMillis();
        Long cacheTime = tmdbCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < TMDB_CACHE_TTL) {
            String cached = tmdbCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        JSONArray results = fetchTmdbTv("/tv/popular?page=" + page, 20);
        String json = new JSONObject().put("results", results).toString();
        tmdbCacheMap.put(cacheKey, json);
        tmdbCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * TMDB详情
     */
    private Response apiTmdbDetail(Map<String, String> params) throws Exception {
        int id = Integer.parseInt(params.getOrDefault("id", "0"));
        String type = params.getOrDefault("type", "movie");
        if (id == 0) return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Missing id");

        String cacheKey = "tmdb_detail_" + type + "_" + id;
        long now = System.currentTimeMillis();
        Long cacheTime = tmdbCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < TMDB_CACHE_TTL) {
            String cached = tmdbCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }

        String endpoint = type.equals("tv") ? "/tv/" + id : "/movie/" + id;
        String url = TMDB_BASE_URL + endpoint + "?api_key=" + TMDB_API_KEY + "&language=zh-CN";
        String body = fetchTmdbUrl(url);
        
        tmdbCacheMap.put(cacheKey, body);
        tmdbCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", body);
    }

    /**
     * TMDB分类页 - 支持电影/剧集/综艺/动漫
     * type: 1=电影, 2=剧集, 3=综艺, 4=动漫
     */
    private Response apiTmdbCategory(Map<String, String> params) throws Exception {
        int type = Integer.parseInt(params.getOrDefault("type", "1"));
        int page = Integer.parseInt(params.getOrDefault("pg", "1"));
        
        String cacheKey = "tmdb_cat_" + type + "_" + page;
        long now = System.currentTimeMillis();
        Long cacheTime = tmdbCacheTimeMap.get(cacheKey);
        if (cacheTime != null && (now - cacheTime) < TMDB_CACHE_TTL) {
            String cached = tmdbCacheMap.get(cacheKey);
            if (cached != null) return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", cached);
        }
        
        JSONArray results = new JSONArray();
        try {
            if (type == 1) {
                // 电影 - 获取全球热门电影
                results = fetchTmdbMovies("/movie/popular?page=" + page, 20);
            } else if (type == 2) {
                // 剧集 - 获取热门剧集
                results = fetchTmdbTv("/tv/popular?page=" + page, 20);
            } else if (type == 3) {
                // 综艺
                results = fetchTmdbTv("/discover/tv?with_genres=10764&sort_by=popularity.desc&page=" + page, 20);
            } else if (type == 4) {
                // 动漫
                results = fetchTmdbTv("/discover/tv?with_genres=16&sort_by=popularity.desc&page=" + page, 20);
            } else if (type == 5) {
                // 短剧 - 返回空，让前端走采集源
                results = new JSONArray();
            }
        } catch (Exception e) {
            Log.d(TAG, "apiTmdbCategory error: " + e.getMessage());
        }
        
        JSONObject result = new JSONObject();
        result.put("list", results);
        result.put("total", results.length());
        result.put("pg", page);
        result.put("hasMore", results.length() >= 18);
        
        String json = result.toString();
        tmdbCacheMap.put(cacheKey, json);
        tmdbCacheTimeMap.put(cacheKey, now);
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json);
    }

    /**
     * TMDB URL请求
     */
    private String fetchTmdbUrl(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("User-Agent", USER_AGENT);
        conn.setRequestProperty("Accept", "application/json");
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        InputStream is = conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (is == null) return "{}";
        BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String l;
        while ((l = r.readLine()) != null) sb.append(l);
        r.close();
        conn.disconnect();
        return sb.toString();
    }
}
