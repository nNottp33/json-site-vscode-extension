import { parentPort, workerData } from 'node:worker_threads';
import { quicktype, InputData, jsonInputForTargetLanguage } from 'quicktype-core';
(async () => {
  const input = jsonInputForTargetLanguage(workerData.language);
  await input.addSource({ name: 'Root', samples: [workerData.text] });
  const inputData = new InputData();
  inputData.addInput(input);
  const result = await quicktype({ inputData, lang: workerData.language, rendererOptions: workerData.language === 'typescript' ? { 'just-types': 'true' } : {} });
  parentPort?.postMessage({ text: result.lines.join('\n') });
})().catch(error => parentPort?.postMessage({ error: error.message }));
