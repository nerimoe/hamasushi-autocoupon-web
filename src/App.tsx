import { useState, useRef, useEffect } from 'react';

// 类型定义
interface LogEntry {
  time: string;
  msg: string;
}

const API_URL = import.meta.env.VITE_API_URL;
const DELAY = import.meta.env.VITE_DELAY; // 适当延迟，避免请求过快

function App() {
  const [surveyUrl, setSurveyUrl] = useState("https://jp-hama-sushi.csfeedback.net/sv/ja/RJPxxxx");
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const logEndRef = useRef<HTMLDivElement>(null);
  const stopSignalRef = useRef(false);

  // 自动滚动日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  };

  const runSurvey = async () => {
    if (!surveyUrl) return alert("URLを入力してください");

    setLoading(true);
    setFinished(false);
    setLogs([]);
    stopSignalRef.current = false;

    let currentUrl = surveyUrl;
    let currentCookies = "";
    let nextFormData = null;

    try {
      addLog("🚀 自動回答を開始します...");

      while (!stopSignalRef.current) {
        // 请求 Worker
        const payload = {
          target_url: currentUrl,
          current_cookies: currentCookies,
          last_form_data: nextFormData
        };

        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();

        // 记录日志
        addLog(data.message);

        // 更新 Cookie 和 URL
        if (data.cookies) currentCookies = data.cookies;
        if (data.next_url) currentUrl = data.next_url;

        // 判断完成
        if (data.status === 'done') {
          setFinished(true); // 触发完成 UI
          addLog("✨ お疲れ様でした！");
          break;
        } else if (data.status === 'error') {
          throw new Error(data.message);
        }

        // 准备下一轮
        nextFormData = data.form_data;
        await new Promise(r => setTimeout(r, DELAY));
      }

    } catch (e: any) {
      addLog(`❌ エラー: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-10 px-4 font-sans text-slate-800">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden border border-slate-200">

        {/* Header */}
        <div className="bg-[#002B5C] p-5 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-[#C4A05F]"></div>
          <h1 className="text-white text-2xl font-bold tracking-widest">はま寿司</h1>
          <p className="text-slate-300 text-xs mt-1 tracking-wider uppercase">Survey Auto-Filler</p>
        </div>

        <div className="p-6 space-y-6">

          {/* URL Input */}
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700">アンケートURL</label>
            <input
              type="text"
              className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-lg focus:border-[#002B5C] focus:outline-none text-sm font-mono text-slate-600"
              placeholder="https://jp-hama-sushi.csfeedback.net/..."
              value={surveyUrl}
              onChange={e => setSurveyUrl(e.target.value)}
              disabled={loading || finished}
            />
          </div>

          {/* Action Button */}
          {!finished ? (
            <button
              onClick={loading ? () => stopSignalRef.current = true : runSurvey}
              className={`w-full py-4 rounded-lg font-bold text-lg shadow-md transition-all flex items-center justify-center gap-2
                ${loading
                  ? 'bg-red-50 text-red-600 border-2 border-red-100 hover:bg-red-100'
                  : 'bg-[#002B5C] text-white hover:bg-[#003875]'
                }
              `}
            >
              {loading ? (
                <><span className="animate-spin text-xl">⏳</span> 停止する</>
              ) : (
                '自動回答スタート'
              )}
            </button>
          ) : (
            // 完成后的跳转按钮
            <div className="animate-fade-in-up space-y-4">
              <div className="bg-green-50 border-l-4 border-green-500 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <span className="text-green-500 text-xl">✓</span>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-green-700 font-bold">
                      アンケート回答完了
                    </p>
                    <p className="text-xs text-green-600 mt-1">
                      サーバー側での処理が完了しました。以下のボタンからクーポン画面を開いてください。
                    </p>
                  </div>
                </div>
              </div>

              <a
                href={surveyUrl}
                target="_blank"
                rel="noreferrer"
                className="block w-full text-center py-4 rounded-lg font-bold text-lg text-white bg-[#C4A05F] hover:bg-[#b08d4f] shadow-lg transform hover:-translate-y-1 transition-all"
              >
                クーポン画面を開く ➔
              </a>

              <button
                onClick={() => setFinished(false)}
                className="block w-full text-center text-sm text-slate-400 hover:text-slate-600 mt-2 underline"
              >
                リセット
              </button>
            </div>
          )}

          {/* Logs */}
          <div className="bg-[#1E1E1E] rounded-lg p-4 h-56 overflow-y-auto font-mono text-xs shadow-inner custom-scrollbar">
            {logs.length === 0 && <span className="text-gray-500 italic">待機中...</span>}
            {logs.map((log, i) => (
              <div key={i} className="mb-1.5 flex gap-2">
                <span className="text-gray-500 shrink-0">[{log.time}]</span>
                <span className={log.msg.includes('完了') ? 'text-[#C4A05F] font-bold' : 'text-slate-300'}>
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