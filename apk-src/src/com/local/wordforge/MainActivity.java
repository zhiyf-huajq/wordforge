package com.local.wordforge;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;

/**
 * 词匠 WordForge —— WebView 外壳。
 *
 * 结构：不依赖任何第三方库（无 AndroidX / AppCompat），只继承系统 Activity，
 * javac 只需 android.jar，d8 只处理本类 —— 构建零依赖、APK 体积极小。
 *
 * 与「纯离线应用」壳的三个不同点：
 *
 * 1. 页面跑在虚拟 https 主机上，不用 file:///android_asset/。
 *    file:// 页面在不透明源里，精读要 fetch 白名单站点会被同源策略挡死；
 *    套一层 https 虚拟主机（资源由 shouldInterceptRequest 直接喂）之后它就是普通 https 页面，
 *    跨域取文按标准 CORS 走 —— 维基媒体接口返回 * 所以能通。代价十几行，换来精读在 APK 里真的可用。
 *
 * 2. 补了原生语音朗读。Android WebView 不实现 Web Speech 的合成部分，
 *    页面的 speechSynthesis 在 WebView 里是空的（或存在但不出声），朗读按钮会静默失效。
 *    这里注入一段 shim，把 speechSynthesis.speak 接到系统 TextToSpeech 上。
 *
 * 3. 系统返回键交给应用自己消化（弹窗 → 跳转栈 → 回首页 → 才退出）。
 *    应用是纯 JS 状态路由，WebView 的 canGoBack() 永远是 false，不接管的话按一下就直接退出了。
 *
 * 仍然保留零依赖壳的两个必备补丁：选文件（onShowFileChooser）和 blob 导出落盘（SAF）。
 */
public class MainActivity extends Activity {

    /* 虚拟主机。shouldInterceptRequest 拦下这个主机的请求并从 assets 喂内容，
       所以它不需要真的能解析 —— 请求根本不会发到网络上去。 */
    private static final String VHOST = "appassets.local";
    private static final String START_URL = "https://" + VHOST + "/index.html";

    private static final String COLOR_PRIMARY = "#3b6ef5";
    private static final String COLOR_BG = "#f7f8fc";

    private static final int REQ_PICK = 1001;
    private static final int REQ_SAVE = 1002;

    /** 导出落盘桥：把 <a download> 的 blob 交给原生，走 SAF 保存（不需要任何存储权限）。 */
    private static final String DL_JS =
        "(function(){try{" +
        "if(window.__wfDlInstalled)return;window.__wfDlInstalled=1;" +
        "var oc=URL.createObjectURL,m=new Map(),oclick=HTMLAnchorElement.prototype.click;" +
        "URL.createObjectURL=function(b){var u=oc.call(URL,b);try{m.set(u,b);}catch(e){}return u;};" +
        "HTMLAnchorElement.prototype.click=function(){" +
        "try{" +
        /* 必须用 getAttribute('href') —— a.href 会被 URL 规范化，跟 createObjectURL 的返回值对不上 */
        "var hu=this.getAttribute?this.getAttribute('href'):null;hu=hu||this.href;" +
        "if(this.download&&hu&&m.has(hu)){" +
        "var b=m.get(hu),nm=this.download,u=hu,fr=new FileReader();" +
        "fr.onload=function(){var s=String(fr.result||''),i=s.indexOf(',');" +
        "if(i>0&&window.WordForgeNative){window.WordForgeNative.save(nm,s.substring(i+1));}};" +
        "fr.readAsDataURL(b);m.delete(u);" +
        "setTimeout(function(){try{URL.revokeObjectURL(u);}catch(e){}},8000);" +
        "return;" +
        "}}catch(e){}" +
        "return oclick.apply(this,arguments);" +
        "};" +
        "}catch(e){}})();";

    /**
     * 语音朗读 shim：让页面的 speechSynthesis 落到系统 TextToSpeech 上。
     * 只实现应用真正会用到的那几个成员（speak / cancel / getVoices），
     * getVoices 返回空数组是刻意的 —— 应用拿不到 voice 时会退回用 lang 判断口音，正是我们要的。
     */
    private static final String TTS_JS =
        "(function(){try{" +
        "if(window.__wfTtsInstalled)return;" +
        "var N=window.WordForgeNative;if(!N||!N.ttsSpeak)return;" +
        "window.__wfTtsInstalled=1;" +
        "function Utt(t){this.text=String(t==null?'':t);this.lang='en-US';this.rate=1;this.pitch=1;" +
        "this.volume=1;this.voice=null;this.onstart=null;this.onend=null;this.onerror=null;}" +
        "var timers=[];" +
        "var synth={" +
        "speaking:false,pending:false,paused:false," +
        "getVoices:function(){return [];}," +
        "speak:function(u){if(!u)return;" +
        "var text=String(u.text||''),lang=String(u.lang||'en-US'),rate=Number(u.rate)||1;" +
        "var accent=/[-_]GB/i.test(lang)?'uk':'us';" +
        "try{if(synth.speaking)N.ttsStop();}catch(e){}" +
        "synth.speaking=true;" +
        "try{if(u.onstart)u.onstart();}catch(e){}" +
        "try{N.ttsSpeak(text,accent,rate);}catch(e){}" +
        /* 用字符数粗估时长，只为了把 speaking 置回 false 并触发 onend */
        "var ms=Math.max(700,Math.min(30000,text.length*72));" +
        "timers.push(setTimeout(function(){synth.speaking=false;" +
        "try{if(u.onend)u.onend();}catch(e){}},ms));}," +
        "cancel:function(){synth.speaking=false;" +
        "for(var i=0;i<timers.length;i++)clearTimeout(timers[i]);timers=[];" +
        "try{N.ttsStop();}catch(e){}}," +
        "pause:function(){synth.paused=true;},resume:function(){synth.paused=false;}," +
        "addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return false;}" +
        "};" +
        "try{Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true,writable:true});}" +
        "catch(e){try{window.speechSynthesis=synth;}catch(e2){}}" +
        "if(!window.SpeechSynthesisUtterance)window.SpeechSynthesisUtterance=Utt;" +
        "}catch(e){}})();";

    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private String saveName;
    private byte[] saveData;

    private TextToSpeech tts = null;
    private volatile boolean ttsReady = false;

    /* 返回键：连按两次直接退出，避免 JS 回过不来时被困在应用里 */
    private static final long BACK_DOUBLE_MS = 900L;
    private long lastBackAt = 0L;
    private boolean backAskPending = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window w = getWindow();
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(Color.parseColor(COLOR_PRIMARY));
        }

        initTts();

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.parseColor(COLOR_BG));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        /* localStorage 是全部学习数据的唯一存储，必须开 */
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        /* 选文件走 SAF，回传的是 content:// —— 关掉的话 WebView 读不到用户选的文件 */
        s.setAllowContentAccess(true);
        s.setAllowFileAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100); // 固定缩放，别让系统字体大小把卡片版式撑坏
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        web.addJavascriptInterface(new NativeBridge(), "WordForgeNative");

        web.setWebViewClient(new WebViewClient() {
            /* ---- 虚拟主机的资源由这里直接喂给 WebView ---- */
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return intercept(request == null ? null : request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return intercept(Uri.parse(url));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request == null ? null : request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(DL_JS, null);
                view.evaluateJavascript(TTS_JS, null);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (fileCb != null) {
                    fileCb.onReceiveValue(null);
                }
                fileCb = cb;
                try {
                    Intent i = params.createIntent();
                    /* 应用的 accept 写的是扩展名（.json,.csv,.txt），WebView 会把它映射成
                       具体 MIME，某些文件管理器下就选不中文件了。统一放开成任意文件，
                       格式由应用自己解析时校验（它本来就会判非法内容并提示）。 */
                    i.setType("*/*");
                    startActivityForResult(i, REQ_PICK);
                    return true;
                } catch (Exception e) {
                    fileCb = null;
                    toast("这台设备没有可用的文件选择器");
                    return false;
                }
            }
        });
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        setContentView(web);
        web.loadUrl(START_URL);
    }

    /* ---------------- 虚拟主机 → assets ---------------- */
    private WebResourceResponse intercept(Uri u) {
        if (u == null) return null;
        if (!VHOST.equals(u.getHost())) return null;  // 白名单站点的请求照常走网络
        String p = u.getPath();
        if (p == null || p.length() == 0 || "/".equals(p)) p = "/index.html";
        try {
            InputStream is = getAssets().open(p.substring(1));
            return new WebResourceResponse(mimeOfPath(p), "utf-8", is);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }
    }

    private static String mimeOfPath(String p) {
        String n = p == null ? "" : p.toLowerCase(Locale.US);
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
        if (n.endsWith(".js")) return "application/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    /* ---------------- 跳转：站外的交给系统浏览器 ---------------- */
    private boolean handleUrl(Uri u) {
        if (u == null) return true;
        String sch = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.US);
        if (VHOST.equals(u.getHost())) return false;   // 自己的虚拟主机，正常加载
        if ("http".equals(sch) || "https".equals(sch)) {
            /* 精读台里的「原文地址」指向外部站点。在应用内 WebView 打开会离开应用、
               又没有地址栏，用户回不来 —— 交给系统浏览器最合适。 */
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception e) {
                toast("没有可用的浏览器");
            }
        }
        return true;
    }

    /* ---------------- 朗读：接系统 TTS ---------------- */
    private void initTts() {
        try {
            tts = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    if (status == TextToSpeech.SUCCESS) {
                        try {
                            tts.setSpeechRate(1.0f);
                            tts.setPitch(1.0f);
                        } catch (Exception e) { /* 个别引擎不支持，忽略 */ }
                        ttsReady = true;
                    }
                }
            });
        } catch (Exception e) {
            tts = null;
        }
    }

    private class NativeBridge {

        @JavascriptInterface
        public void ttsSpeak(final String text, final String accent, final float rate) {
            if (text == null || text.length() == 0) return;
            /* 单条太长会被引擎截断得莫名其妙，掐到 4000 字符（应用本来就是按句/按词念的） */
            final String t = text.length() > 4000 ? text.substring(0, 4000) : text;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    doTtsSpeak(t, accent, rate);
                }
            });
        }

        @JavascriptInterface
        public void ttsStop() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (tts != null) {
                        try { tts.stop(); } catch (Exception e) { }
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean ttsAvailable() {
            return ttsReady;
        }

        @JavascriptInterface
        public void save(final String name, final String base64) {
            if (name == null || base64 == null) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    saveName = name;
                    try {
                        saveData = Base64.decode(base64, Base64.DEFAULT);
                    } catch (Exception e) {
                        saveData = null;
                    }
                    if (saveData == null) { toast("导出失败：数据解码异常"); return; }
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mimeOf(saveName));
                    i.putExtra(Intent.EXTRA_TITLE, saveName);
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (Exception e) {
                        toast("此设备不支持选择保存位置");
                    }
                }
            });
        }
    }

    private void doTtsSpeak(String text, String accent, float rate) {
        if (tts == null) initTts();
        if (tts == null) { toast("这台设备没有可用的语音引擎"); return; }
        Locale loc = "uk".equals(accent) ? Locale.UK : Locale.US;
        int r = tts.setLanguage(loc);
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            r = tts.setLanguage(Locale.ENGLISH);
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                toast("手机里没装英语语音包，可到「系统设置 → 文字转语音」里安装");
                return;
            }
        }
        float rt = (rate > 0.3f && rate < 3.0f) ? rate : 1.0f;
        try { tts.setSpeechRate(rt); } catch (Exception e) { }
        try {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null);
        } catch (Exception e) {
            /* 极少数引擎在 onInit 回调之前会拒收，隔一小会儿重试一次（不阻塞 UI 线程） */
            web.postDelayed(new Runnable() {
                @Override
                public void run() {
                    try { tts.speak(text, TextToSpeech.QUEUE_FLUSH, null); }
                    catch (Exception e2) { toast("朗读失败"); }
                }
            }, 400);
        }
    }

    private static String mimeOf(String name) {
        String n = name == null ? "" : name.toLowerCase(Locale.US);
        if (n.endsWith(".csv")) return "text/csv";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".txt")) return "text/plain";
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    /* ---------------- 返回键：交给应用逐层消化 ---------------- */
    @Override
    public void onBackPressed() {
        if (web == null) { finish(); return; }
        long now = System.currentTimeMillis();
        if (backAskPending || now - lastBackAt < BACK_DOUBLE_MS) {
            finish();   // 连按两次 = 确认退出
            return;
        }
        lastBackAt = now;
        backAskPending = true;
        try {
            web.evaluateJavascript(
                "(function(){try{return (window.__wfBack&&window.__wfBack())?'1':'0';}catch(e){return '0';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String v) {
                        backAskPending = false;
                        boolean handled = v != null && v.indexOf('1') >= 0;
                        if (!handled) finish();
                    }
                });
        } catch (Exception e) {
            backAskPending = false;
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_PICK) {
            if (fileCb != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                }
                fileCb.onReceiveValue(result);
                fileCb = null;
            }
            return;
        }

        if (requestCode == REQ_SAVE) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && saveData != null) {
                OutputStream os = null;
                try {
                    os = getContentResolver().openOutputStream(data.getData());
                    if (os != null) {
                        os.write(saveData);
                        os.flush();
                        ok = true;
                    }
                } catch (Exception e) {
                    ok = false;
                } finally {
                    if (os != null) {
                        try { os.close(); } catch (Exception ignored) { }
                    }
                }
            }
            if (resultCode == RESULT_OK) {
                toast(ok ? "已导出到所选位置" : "导出失败");
            }
            saveName = null;
            saveData = null;
            return;
        }

        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onPause() {
        if (web != null) {
            /* 保存有 350ms 防抖，切后台前先催一次同步落盘，免得进程被回收丢最后一次评价 */
            try {
                web.evaluateJavascript("window.__wfFlushSave&&window.__wfFlushSave();", null);
            } catch (Exception e) { }
            web.onPause();
        }
        if (tts != null) {
            try { tts.stop(); } catch (Exception e) { }
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception e) { }
            tts = null;
            ttsReady = false;
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
