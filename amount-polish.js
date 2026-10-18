const plainCalculatorHTML=calculatorHTML;
calculatorHTML=function(edit){return plainCalculatorHTML(edit).replace('>⌫</button>','><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h12v14H9L2 12z"/><path d="m12 9 6 6m0-6-6 6"/></svg></button>');};
