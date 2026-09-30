import React, { useEffect, useState } from 'react';

export interface CredentialManagerValues {
  baseUrl: string;
  username: string;
  password: string;
  browser: 'chromium' | 'firefox' | 'webkit';
  headed: boolean;
}

interface CredentialManagerModalProps {
  isOpen: boolean;
  initialBaseUrl?: string;
  initialBrowser?: 'chromium' | 'firefox' | 'webkit';
  initialHeaded?: boolean;
  onCancel: () => void;
  onConfirm: (values: CredentialManagerValues) => void;
}

/**
 * Sprint 4 Credential Manager — collects the runtime values Execute needs
 * (Base URL, Username, Password, Browser, Mode) immediately before a run
 * starts. Values are held only in this component's local state and the
 * one-shot runService.startRun() request body — never written to any
 * suite file, never logged, never persisted to disk. See RunService#executeRun
 * on the backend, which injects them into the Playwright child process's
 * environment via ProcessBuilder and discards them once the process exits.
 */
export const CredentialManagerModal: React.FC<CredentialManagerModalProps> = ({
  isOpen,
  initialBaseUrl = '',
  initialBrowser = 'chromium',
  initialHeaded = false,
  onCancel,
  onConfirm
}) => {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [browser, setBrowser] = useState<'chromium' | 'firefox' | 'webkit'>(initialBrowser);
  const [headed, setHeaded] = useState(initialHeaded);

  // Re-seed from the caller's current context every time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setBaseUrl(initialBaseUrl);
      setUsername('');
      setPassword('');
      setShowPassword(false);
      setBrowser(initialBrowser);
      setHeaded(initialHeaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    // Strip any trailing slash(es)/backslash(es) so the generated
    // page.goto(`${BASE_URL}/path`) never doubles up the separator
    // regardless of whether the user typed a trailing one here.
    const normalizedBaseUrl = baseUrl.trim().replace(/[\\/]+$/, '');
    onConfirm({ baseUrl: normalizedBaseUrl, username, password, browser, headed });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-[#181c24] border border-[#262a33] rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-4 text-[#dfe2ee]">
        <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#4cd7f6] text-[20px]">key</span>
            <h3 className="text-sm font-semibold">Credential Manager</h3>
          </div>
          <button
            onClick={onCancel}
            className="text-[#908fa0] hover:text-[#dfe2ee]"
            aria-label="Cancel"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <p className="text-[11px] font-mono text-[#908fa0]">
          Values are used for this run only and are never saved to disk.
        </p>

        <form onSubmit={handleConfirm} className="space-y-3">
          <div>
            <label className="block text-xs font-mono text-[#c7c4d7] mb-1">
              Base URL <span className="text-[#4cd7f6]">(BASE_URL)</span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-app.example.com"
              autoComplete="off"
              className="w-full h-9 px-3 rounded-lg bg-[#11141c] border border-[#262a33] text-xs font-mono text-[#dfe2ee] focus:border-[#4cd7f6] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-[#c7c4d7] mb-1">
              Username <span className="text-[#4cd7f6]">(APP_USERNAME)</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="w-full h-9 px-3 rounded-lg bg-[#11141c] border border-[#262a33] text-xs font-mono text-[#dfe2ee] focus:border-[#4cd7f6] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-[#c7c4d7] mb-1">
              Password <span className="text-[#4cd7f6]">(APP_PASSWORD)</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                className="w-full h-9 px-3 pr-9 rounded-lg bg-[#11141c] border border-[#262a33] text-xs font-mono text-[#dfe2ee] focus:border-[#4cd7f6] outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#908fa0] hover:text-[#dfe2ee] cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-[#c7c4d7] mb-1">Browser</label>
              <div className="flex items-center gap-1 bg-[#11141c] p-1 rounded-lg border border-[#262a33]">
                {(['chromium', 'firefox', 'webkit'] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBrowser(b)}
                    className={`flex-1 px-2 py-1 rounded text-[10px] font-mono uppercase transition-colors cursor-pointer ${
                      browser === b
                        ? 'bg-[#0566d9] text-white font-semibold'
                        : 'text-[#908fa0] hover:text-[#dfe2ee]'
                    }`}
                  >
                    {b === 'chromium' ? 'CHR' : b === 'firefox' ? 'FFX' : 'WKT'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-[#c7c4d7] mb-1">Mode</label>
              <button
                type="button"
                onClick={() => setHeaded((v) => !v)}
                className={`w-full h-[30px] rounded-lg text-[10px] font-mono font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                  headed
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-[#11141c] border border-[#262a33] text-[#c7c4d7]'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {headed ? 'desktop_windows' : 'terminal'}
                </span>
                <span>{headed ? 'Headed' : 'Headless'}</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#262a33]">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg bg-[#262a33] text-xs text-[#dfe2ee] hover:bg-[#31353e] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-[#0566d9] hover:bg-[#0455b5] text-xs font-mono text-white font-medium cursor-pointer"
            >
              Execute
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
