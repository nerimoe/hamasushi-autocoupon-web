import { useState, useRef, useEffect } from 'react';

// 类型定义
interface LogEntry {
  time: string;
  msg: string;
}

const API_URL = import.meta.env.VITE_API_URL;
const DELAY = 300; // 延迟设置，减轻服务器压力

function App() {
  // 状态管理
  const [surveyUrl, setSurveyUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const stopSignalRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  };

  const runSurvey = async () => {
    if (!surveyUrl) return alert("请输入URL");

    setLoading(true);
    setFinished(false);
    setLogs([]);
    stopSignalRef.current = false;

    let currentUrl = surveyUrl;
    let cookieMap = new Map<string, string>(); // Cookie 管理器

    try {
      addLog("🚀 浏览器模式启动...");

      let method = 'GET';
      let payloadData: string | null = null;
      let pageCount = 1;

      while (!stopSignalRef.current) {
        // --- 1. 构建请求头 ---
        const headers: Record<string, string> = {};
        const cookieStr = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers['Cookie'] = cookieStr;
        headers['Referer'] = currentUrl;

        if (method === 'POST') {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }

        // --- 2. 通过 Worker 代理访问 ---
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

        // --- 3. 持久化 Cookie ---
        if (json.set_cookie && Array.isArray(json.set_cookie)) {
          json.set_cookie.forEach((c: string) => {
            const mainPart = c.split(';')[0].trim();
            const idx = mainPart.indexOf('=');
            if (idx !== -1) {
              cookieMap.set(mainPart.substring(0, idx), mainPart.substring(idx + 1));
            }
          });
        }

        // --- 4. 处理 302 重定向 ---
        if ([301, 302, 303, 307].includes(json.status) && json.location) {
          currentUrl = new URL(json.location, currentUrl).toString();
          method = 'GET';
          payloadData = null;
          continue;
        }

        // --- 5. 解析 HTML 结构 ---
        const parser = new DOMParser();
        const doc = parser.parseFromString(json.html, "text/html");

        // 页面元素判定点
        const modeInput = doc.querySelector('input[name="mode"]') as HTMLInputElement;
        const qInputs = doc.querySelectorAll('input[name="q[]"]');
        const numberWrap = doc.querySelector('.number_wrap');

        // 【判定：完成画面】
        if (numberWrap || json.html.includes('/coupon/') || json.html.includes('クーポンコード')) {
          if (!modeInput || modeInput.value !== 'init') {
            addLog("✨ 已到达优惠券画面！");
            setFinished(true);
            break;
          }
        }

        // 【判定：初始化画面 (Init)】
        if (modeInput && modeInput.value === 'init') {
          if (method === 'POST') throw new Error("输入数据被拒绝，回到初始页面。请检查代码或参数。");

          addLog(">>> [初始化] 解析回执信息并提交...");

          const formData = new URLSearchParams();
          formData.set('mode', 'init');

          const getVal = (name: string) => (doc.querySelector(`input[name="${name}"]`) as HTMLInputElement)?.value || '';
          const getSelectVal = (name: string) => {
            const el = doc.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
            if (!el) return '';
            const selected = el.querySelector('option[selected]') || el.options[0];
            return (selected as HTMLOptionElement).value;
          };

          formData.set('shop_code', getVal('shop_code'));
          let rCode = getVal('receipt_code');
          if (!rCode) {
            const pathParts = new URL(currentUrl).pathname.split('/');
            const codeFromUrl = pathParts[pathParts.length - 1];
            if (codeFromUrl.startsWith('RJP')) rCode = codeFromUrl;
          }
          formData.set('receipt_code', rCode);
          formData.set('month', getSelectVal('month'));
          formData.set('day', getSelectVal('day'));
          formData.set('visit_hour', getSelectVal('visit_hour'));
          formData.set('agree', 'on');

          addLog(`回执单号: ${formData.get('receipt_code')}`);
          method = 'POST';
          payloadData = formData.toString();
        }

        // 【判定：回答画面 (存在问题项目)】
        else if (qInputs.length > 0) {
          // 修复点：获取当前页面所有问题标题
          const questionTitles = Array.from(doc.querySelectorAll('.question_title'))
            .map(el => el.textContent?.trim().replace(/\s+/g, ' '))
            .filter(t => t);

          const pageTitle = questionTitles.length > 0 ? questionTitles.join(' | ') : `第 ${pageCount} 页`;
          addLog(`📝 [P${pageCount}] ${pageTitle.substring(0, 50)}${pageTitle.length > 50 ? '...' : ''}`);

          const formData = new URLSearchParams();

          // 继承所有隐藏字段
          doc.querySelectorAll('input[type="hidden"]').forEach(h => {
            const input = h as HTMLInputElement;
            if (input.name.endsWith('[]')) {
              formData.append(input.name, input.value);
            } else {
              formData.set(input.name, input.value);
            }
          });

          // 自动填充回答并打印到日志
          qInputs.forEach((qHidden) => {
            const qId = (qHidden as HTMLInputElement).value;
            const prefix = `q_${qId}`;

            // 1. 单选框 (Radio)
            const radios = doc.querySelectorAll(`input[name="${prefix}"][type="radio"]`);
            if (radios.length > 0) {
              const val = (radios[0] as HTMLInputElement).value;
              formData.set(prefix, val);
              // 获取对应的文本标签（如有）
              const label = doc.querySelector(`label[for="${radios[0].id}"]`)?.textContent?.trim() || val;
              addLog(`   └ 选择(单选): ${label}`);
              return;
            }

            // 2. 多选框 (Checkbox)
            const checkboxes = doc.querySelectorAll(`input[name^="${prefix}"][type="checkbox"]`);
            if (checkboxes.length > 0) {
              const cb = checkboxes[0] as HTMLInputElement;
              formData.set(cb.name, cb.value);
              addLog(`   └ 选择(多选): ${cb.value}`);
              return;
            }

            // 3. 文本输入 (Text/TextArea)
            const texts = doc.querySelectorAll(`textarea[name^="${prefix}"], input[name^="${prefix}"][type="text"]`);
            texts.forEach(t => {
              formData.set((t as HTMLInputElement).name, "");
            });
          });

          pageCount++;
          method = 'POST';
          payloadData = formData.toString();
        }

        // 【判定：中间页/其他】
        else {
          const formData = new URLSearchParams();
          doc.querySelectorAll('input, select').forEach((el: any) => {
            if (el.name && el.type !== 'submit' && el.type !== 'button') {
              if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) return;
              formData.set(el.name, el.value);
            }
          });

          if (Array.from(formData.keys()).length === 0) throw new Error("无法识别页面内容，停止。");
          method = 'POST';
          payloadData = formData.toString();
        }

        await new Promise(r => setTimeout(r, DELAY));
      }

    } catch (e: any) {
      addLog(`❌ 停止: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-10 px-4 font-sans text-slate-800">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden border border-slate-200">
        <div className="bg-[#002B5C] p-5 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-[#C4A05F]"></div>
          <h1 className="text-white text-2xl font-bold tracking-widest">はま寿司</h1>
          <p className="text-slate-300 text-xs mt-1 tracking-wider uppercase">自动问卷填报系统</p>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700">问卷 URL</label>
            <input
              type="text"
              className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-lg focus:border-[#002B5C] focus:outline-none text-sm font-mono text-slate-600"
              value={surveyUrl}
              onChange={e => setSurveyUrl(e.target.value)}
              disabled={loading || finished}
            />
          </div>

          {!finished ? (
            <button
              onClick={loading ? () => stopSignalRef.current = true : runSurvey}
              className={`w-full py-4 rounded-lg font-bold text-lg shadow-md transition-all flex items-center justify-center gap-2
                ${loading ? 'bg-red-50 text-red-600 border-2 border-red-100' : 'bg-[#002B5C] text-white hover:bg-[#003875]'}`}
            >
              {loading ? '停止运行' : '开始自动回答'}
            </button>
          ) : (
            <div className="text-center space-y-4">
              <div className="bg-green-100 text-green-800 p-4 rounded font-bold">填报完成</div>
              <a href={surveyUrl} target="_blank" rel="noreferrer" className="block w-full text-center py-4 rounded-lg font-bold text-lg text-white bg-[#C4A05F]">
                打开优惠券页面 ➔
              </a>
            </div>
          )}

          <div className="bg-[#1E1E1E] rounded-lg p-4 h-80 overflow-y-auto font-mono text-xs shadow-inner custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className="mb-1.5 flex gap-2">
                <span className="text-gray-500 shrink-0">[{log.time}]</span>
                <span className={log.msg.startsWith('   └') ? "text-blue-400" : "text-slate-300"}>{log.msg}</span>
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