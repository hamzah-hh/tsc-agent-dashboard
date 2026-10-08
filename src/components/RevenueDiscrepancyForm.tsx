import React, { useState } from 'react';
import { AlertCircle, ExternalLink, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface RevenueDiscrepancyFormProps {
  /** If true, renders embedded inline. If false or collapsable, supports expand/collapse. */
  defaultExpanded?: boolean;
  className?: string;
}

export function RevenueDiscrepancyForm({
  defaultExpanded = true,
  className = '',
}: RevenueDiscrepancyFormProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const formUrl = 'https://forms.cloud.microsoft/r/yjBBFZhSyj?embed=true';
  const directFormUrl = 'https://forms.cloud.microsoft/r/yjBBFZhSyj';

  return (
    <div
      id="revenue-discrepancy-section"
      className={`bg-white dark:bg-slate-900 border border-amber-200/90 dark:border-amber-900/60 rounded-2xl shadow-xs overflow-hidden transition-all ${className}`}
    >
      {/* Header Bar */}
      <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent dark:from-amber-950/40 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-100 dark:border-amber-900/40">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-bold text-slate-950 dark:text-white">
                Revenue Discrepancy Form
              </h3>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
                Official Support
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              Notice a missing order, incorrect sales amount, or misattributed channel revenue? Fill out this Microsoft Form to submit an audit request to the finance & ops team.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <a
            href={directFormUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 shadow-xs transition"
            title="Open in new window"
          >
            <span>Open in Fullscreen</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition"
          >
            <span>{isExpanded ? 'Hide Form' : 'Show Form'}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Embedded Iframe Container */}
      {isExpanded && (
        <div className="p-3 sm:p-5 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="w-full flex justify-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-inner">
            <iframe
              title="Revenue Discrepancy Form"
              width="640px"
              height="600px"
              src={formUrl}
              frameBorder="0"
              marginWidth={0}
              marginHeight={0}
              style={{
                border: 'none',
                maxWidth: '100%',
                width: '100%',
                minHeight: '540px',
                height: '620px',
                maxHeight: '85vh',
              }}
              allowFullScreen
            />
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
            <span className="flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
              Inquiries are logged directly into Microsoft Forms for operations review.
            </span>
            <span className="font-mono text-[10px]">Response time: ~24-48 hrs</span>
          </div>
        </div>
      )}
    </div>
  );
}
