import { useState, useRef, useEffect } from 'react';

// 日志类型定义
interface LogEntry {
  time: string;
  msg: string;
  type?: 'info' | 'success' | 'error' | 'debug';
}

const API_URL = import.meta.env.VITE_API_URL; // 确保 .env 里配置了 Worker 地址
const DELAY = 1500; // 1.5秒延迟，防止请求过快被封

function App() {
  const [surveyUrl, setSurveyUrl] = useState("https://jp-hama-sushi.csfeedback.net/sv/ja/RJPxxxx");
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const stopSignalRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动日志到底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string, type: 'info' | 'success' | 'error' | 'debug' = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, type }]);
  };

  const runSurvey = async () => {
    if (!surveyUrl) return alert("请输入问卷 URL");

    setLoading(true);
    setFinished(false);
    setLogs([]);
    stopSignalRef.current = false;

    let currentUrl = surveyUrl;
    let cookieMap = new Map<string, string>(); // 模拟浏览器的 Cookie Jar

    try {
      addLog("🚀 开始执行自动化脚本...", 'info');

      let method = 'GET';
      let payloadData: string | null = null;

      while (!stopSignalRef.current) {
        // --- 1. 准备请求头 ---
        const headers: Record<string, string> = {};

        // 构建 Cookie 字符串
        const cookieStr = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers['Cookie'] = cookieStr;

        // 必须带上 Referer
        headers['Referer'] = currentUrl;

        // 【关键修复】如果是 POST，必须显式声明表单类型，否则服务器会拒收数据
        if (method === 'POST') {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }

        // --- 2. 发送请求给 Worker ---
        const proxyBody = {
          url: currentUrl,
          method: method,
          headers: headers,
          data: payloadData
        };

        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(proxyBody)
        });

        const json = await res.json();
        if (json.error) throw new Error(json.error);

        // --- 3. 更新 Cookie ---
        if (json.set_cookie && Array.isArray(json.set_cookie)) {
          json.set_cookie.forEach((c: string) => {
            const mainPart = c.split(';')[0].trim();
            const idx = mainPart.indexOf('=');
            if (idx !== -1) {
              const key = mainPart.substring(0, idx);
              const val = mainPart.substring(idx + 1);
              cookieMap.set(key, val);
            }
          });
        }

        // --- 4. 处理重定向 (302) ---
        if ([301, 302, 303, 307].includes(json.status) && json.location) {
          const nextUrl = new URL(json.location, currentUrl).toString();
          // addLog(`🔄 重定向至: ${nextUrl}`, 'debug');
          currentUrl = nextUrl;
          method = 'GET';
          payloadData = null;
          continue; // 跳过解析，直接请求新地址
        }

        // --- 5. 解析 HTML ---
        const parser = new DOMParser();
        const doc = parser.parseFromString(json.html, "text/html");

        // --- 6. 页面逻辑判断 ---
        const modeInput = doc.querySelector('input[name="mode"]') as HTMLInputElement;
        const qInputs = doc.querySelectorAll('input[name="q[]"]');

        // 检查是否包含 coupon 或者 number_wrap (结束页特征)
        if (doc.querySelector('.number_wrap') || json.html.includes('/coupon/') || json.html.includes('クーポン')) {
          // 再次确认不是 init 页面 (init 页面也有 coupon 文本)
          if (!modeInput || modeInput.value !== 'init') {
            addLog("✨ 已到达优惠券页面，任务完成！", 'success');
            setFinished(true);
            break;
          }
        }

        // === 场景 A: 初始页面 (Init) ===
        if (modeInput && modeInput.value === 'init') {
          // 如果我们刚刚 POST 提交过，却又回到了 init，说明被拒绝了
          if (method === 'POST') {
            addLog(`⚠️ 警告: 数据被服务器拒绝，退回首页。`, 'error');
            console.error("Payload was:", payloadData);
            throw new Error("无限循环检测：无法通过初始化页面");
          }

          addLog(">>> [初始化] 正在解析小票信息...", 'info');

          const formData = new URLSearchParams();
          formData.set('mode', 'init');

          // 提取 input 字段 (shop_code, receipt_code 等)
          // 使用具体的 CSS 选择器更安全
          const inputs = ['shop_code', 'receipt_code'];
          inputs.forEach(name => {
            const el = doc.querySelector(`input[name="${name}"]`) as HTMLInputElement;
            if (el) formData.set(name, el.value);
          });

          // 提取 select 字段 (month, day, visit_hour)
          doc.querySelectorAll('select').forEach(select => {
            const sel = select as HTMLSelectElement;
            // 优先选 selected，否则选第一个
            const selectedOpt = sel.querySelector('option[selected]') || sel.options[0];
            if (selectedOpt) formData.set(sel.name, (selectedOpt as HTMLOptionElement).value);
          });

          // 【关键】强制勾选同意 Checkbox
          // 服务器期望收到 "agree=on"
          formData.set('agree', 'on');

          // 补救措施：如果 hidden 里的 receipt_code 是空的，尝试从 URL 获取
          if (!formData.get('receipt_code')) {
            const urlObj = new URL(currentUrl);
            const pathParts = urlObj.pathname.split('/');
            const codeFromUrl = pathParts.find(p => p.startsWith('RJP'));
            if (codeFromUrl) formData.set('receipt_code', codeFromUrl);
          }

          const rCode = formData.get('receipt_code');
          addLog(`📄 识别到小票号: ${rCode || '未找到'}`, 'debug');
          addLog(`📤 提交初始化数据...`, 'info');

          method = 'POST';
          payloadData = formData.toString();
        }

        // === 场景 B: 答题页面 ===
        else if (qInputs.length > 0) {
          // 提取题目文本，不再显示 Page X
          const titleEl = doc.querySelector('.question_title');
          const fullTitle = titleEl ? titleEl.textContent?.trim() : "未命名题目";
          // 截取前20个字符避免日志太长
          const shortTitle = fullTitle?.length && fullTitle.length > 20 ? fullTitle.substring(0, 20) + "..." : fullTitle;

          addLog(`📝 [答题] ${shortTitle}`, 'info');

          const formData = new URLSearchParams();

          // 1. 继承所有 hidden 字段 (session 状态维持)
          doc.querySelectorAll('input[type="hidden"]').forEach(h => {
            const input = h as HTMLInputElement;
            // 排除 q[]，因为我们要手动处理题目
            if (input.name !== 'q[]') {
              formData.append(input.name, input.value);
            }
          });

          // 2. 自动回答题目
          qInputs.forEach((qHidden) => {
            const qId = (qHidden as HTMLInputElement).value;
            const prefix = `q_${qId}`;

            // 单选 (Radio): 选第一个
            const radios = doc.querySelectorAll(`input[name="${prefix}"][type="radio"]`);
            if (radios.length > 0) {
              const val = (radios[0] as HTMLInputElement).value;
              formData.set(prefix, val);
              return;
            }

            // 多选 (Checkbox): 选第一个
            const checkboxes = doc.querySelectorAll(`input[name^="${prefix}"][type="checkbox"]`);
            if (checkboxes.length > 0) {
              const cb = checkboxes[0] as HTMLInputElement;
              formData.set(cb.name, cb.value);
              return;
            }

            // 文本框: 填空 (必须传空字符串，否则可能报错)
            const texts = doc.querySelectorAll(`textarea[name^="${prefix}"], input[name^="${prefix}"][type="text"]`);
            texts.forEach(t => {
              formData.set((t as HTMLInputElement).name, "");
            });
          });

          method = 'POST';
          payloadData = formData.toString();
        }

        // === 场景 C: 未知/过渡页面 ===
        else {
          // 尝试提取所有字段盲目提交
          const formData = new URLSearchParams();
          doc.querySelectorAll('input, select').forEach((el: any) => {
            if (el.name && el.type !== 'submit' && el.type !== 'button') {
              if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) return;
              formData.append(el.name, el.value);
            }
          });

          if (Array.from(formData.keys()).length === 0) {
            // 真的什么都没有，可能是出错了或者HTML结构变了
            console.error("HTML Dump:", json.html);
            throw new Error("解析失败：遇到无法识别的页面结构");
          }

          addLog("➡️ 正在跳转下一页...", 'debug');
          method = 'POST';
          payloadData = formData.toString();
        }

        // 模拟人类操作延迟
        await new Promise(r => setTimeout(r, DELAY));
      }

    } catch (e: any) {
      addLog(`❌ 错误停止: ${e.message}`, 'error');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-10 px-4 font-sans text-slate-800">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden border border-slate-200">

        {/* 顶部标题栏 */}
        <div className="bg-[#002B5C] p-5 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-[#C4A05F]"></div>
          <h1 className="text-white text-2xl font-bold tracking-widest">HAMA SUSHI</h1>
          <p className="text-slate-300 text-xs mt-1 tracking-wider uppercase">Survey Auto-Filler</p>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700">问卷链接 (URL)</label>
            <input
              type="text"
              className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-lg focus:border-[#002B5C] focus:outline-none text-sm font-mono text-slate-600"
              placeholder="https://jp-hama-sushi.csfeedback.net/..."
              value={surveyUrl}
              onChange={e => setSurveyUrl(e.target.value)}
              disabled={loading || finished}
            />
          </div>

          {!finished ? (
            <button
              onClick={loading ? () => stopSignalRef.current = true : runSurvey}
              className={`w-full py-4 rounded-lg font-bold text-lg shadow-md transition-all flex items-center justify-center gap-2
                ${loading
                  ? 'bg-red-50 text-red-600 border-2 border-red-100 hover:bg-red-100'
                  : 'bg-[#002B5C] text-white hover:bg-[#003875]'}`}
            >
              {loading ? (
                <><span className="animate-spin text-xl">⏳</span> 停止运行</>
              ) : (
                '开始自动回答'
              )}
            </button>
          ) : (
            <div className="animate-fade-in-up space-y-4">
              <div className="bg-green-50 border-l-4 border-green-500 p-4">
                <p className="text-sm text-green-700 font-bold">✓ 问卷已完成</p>
                <p className="text-xs text-green-600 mt-1">请点击下方按钮查看优惠券。</p>
              </div>
              <a href={surveyUrl} target="_blank" rel="noreferrer" className="block w-full text-center py-4 rounded-lg font-bold text-lg text-white bg-[#C4A05F] hover:bg-[#b08d4f] shadow-lg">
                打开优惠券页面 ➔
              </a>
              <button onClick={() => setFinished(false)} className="block w-full text-center text-sm text-slate-400 mt-2 underline">
                重置
              </button>
            </div>
          )}

          {/* 日志窗口 */}
          <div className="bg-[#1E1E1E] rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs shadow-inner custom-scrollbar border border-slate-700">
            {logs.length === 0 && <span className="text-gray-500 italic">等待开始...</span>}
            {logs.map((log, i) => (
              <div key={i} className="mb-1.5 flex gap-2">
                <span className="text-gray-500 shrink-0">[{log.time}]</span>
                <span className={`${log.type === 'error' ? 'text-red-400 font-bold' :
                  log.type === 'success' ? 'text-green-400 font-bold' :
                    log.type === 'debug' ? 'text-gray-500' :
                      'text-slate-300'
                  }`}>
                  {log.msg}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;