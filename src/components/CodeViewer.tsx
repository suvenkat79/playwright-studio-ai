import React, { useState } from 'react';
import { SuiteFile } from '../types';

interface CodeViewerProps {
  files: SuiteFile[];
  activeFileId: string;
  onSelectFile: (fileId: string) => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  files,
  activeFileId,
  onSelectFile
}) => {
  const [copied, setCopied] = useState(false);
  const activeFile = files.find((f) => f.id === activeFileId) || files[0];

  const handleCopy = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Syntax colorizer helper for typescript code lines
  const renderHighlightedLine = (line: string) => {
    if (!line.trim()) {
      return <span>&nbsp;</span>;
    }

    // Comments
    if (line.trim().startsWith('//')) {
      return <span className="text-[#908fa0] italic">{line}</span>;
    }

    // Split and highlight common keywords and tokens
    const parts = line.split(
      /(\bimport\b|\bfrom\b|\bexport\b|\bclass\b|\breadonly\b|\bconstructor\b|\basync\b|\bawait\b|\bstring\b|\bboolean\b|\bnumber\b|\bthis\b|'[^']*'|"[^"]*"|\bpage\b|\bLocator\b|\bPage\b|\bexpect\b|\btest\b)/g
    );

    return (
      <>
        {parts.map((part, i) => {
          if (
            ['import', 'from', 'export', 'class', 'readonly', 'constructor', 'async', 'await'].includes(
              part
            )
          ) {
            return (
              <span key={i} className="text-[#4cd7f6]">
                {part}
              </span>
            );
          }
          if (['Page', 'Locator', 'expect', 'string', 'boolean'].includes(part)) {
            return (
              <span key={i} className="text-[#adc6ff]">
                {part}
              </span>
            );
          }
          if (['this', 'page', 'test'].includes(part)) {
            return (
              <span key={i} className="text-[#c0c1ff]">
                {part}
              </span>
            );
          }
          if (
            (part.startsWith("'") && part.endsWith("'")) ||
            (part.startsWith('"') && part.endsWith('"'))
          ) {
            return (
              <span key={i} className="text-[#c0c1ff]">
                {part}
              </span>
            );
          }
          if (part.includes('IncidentManagementPage')) {
            return (
              <span key={i} className="text-[#d8e2ff]">
                {part}
              </span>
            );
          }
          if (
            part.includes('getByRole') ||
            part.includes('getByLabel') ||
            part.includes('getByTestId') ||
            part.includes('getByText') ||
            part.includes('click') ||
            part.includes('fill') ||
            part.includes('toBeVisible')
          ) {
            return (
              <span key={i} className="text-[#4cd7f6]">
                {part}
              </span>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </>
    );
  };

  const lines = activeFile.content.split('\n');

  return (
    <section className="flex flex-col bg-[#0a0e16] rounded-xl overflow-hidden shadow-lg border border-[#262a33]">
      {/* File Selector Bar */}
      <div className="flex items-center justify-between gap-1.5 bg-[#262a33] px-3 py-2 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="material-symbols-outlined text-[16px] text-[#4cd7f6] flex-shrink-0">
            code
          </span>

          {files.map((file) => {
            const isSelected = file.id === activeFileId;
            return (
              <button
                key={file.id}
                onClick={() => onSelectFile(file.id)}
                className={`file-chip px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#0a0e16] text-[#dfe2ee] font-medium shadow-xs'
                    : 'bg-transparent text-[#c7c4d7] hover:bg-[#1c2028]'
                }`}
              >
                <span>{file.name}</span>
                {isSelected && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#adc6ff]"></span>
                )}
              </button>
            );
          })}
        </div>

        {/* Copy Button */}
        <button
          onClick={handleCopy}
          aria-label="Copy code"
          className="h-7 px-2.5 rounded bg-[#31353e] hover:bg-[#3d424e] text-[#c7c4d7] hover:text-[#dfe2ee] flex items-center gap-1 text-[11px] font-mono flex-shrink-0 ml-auto transition-colors cursor-pointer"
          id="copyCodeBtn"
        >
          <span className="material-symbols-outlined text-[14px]">
            {copied ? 'check' : 'content_copy'}
          </span>
          <span id="copyFeedback">{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>

      {/* Code Editor Canvas with Syntax Line-numbers */}
      <div className="relative w-full overflow-x-auto p-3 sm:p-4 bg-[#0a0e16] font-mono text-[11px] leading-relaxed max-h-[380px] overflow-y-auto">
        <pre className="font-mono text-[11px] text-[#dfe2ee] selection:bg-[#8083ff]/30">
          <code>
            {lines.map((line, idx) => (
              <div key={idx} className="flex hover:bg-[#1c2028]/40 transition-colors">
                <span className="w-7 text-[#908fa0] select-none pr-3 text-right flex-shrink-0 font-mono text-[10px] leading-relaxed pt-0.5">
                  {idx + 1}
                </span>
                <span className="whitespace-pre flex-1">
                  {renderHighlightedLine(line)}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>

      {/* Inspector Mini Status */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1c2028] text-[#c7c4d7] text-[10px] font-mono border-t border-[#262a33]">
        <div className="flex items-center gap-1.5 truncate">
          <span className="inline-block w-2 h-2 rounded-full bg-[#4cd7f6] flex-shrink-0"></span>
          <span className="truncate">{activeFile.description}</span>
        </div>
        <span className="text-[#adc6ff] font-mono whitespace-nowrap pl-2">
          {lines.length} LOC
        </span>
      </div>
    </section>
  );
};
