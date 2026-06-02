/**
 * 기획서 파일에서 텍스트 추출 (PDF, DOCX → TC 생성용 문자열)
 */
const fs = require('fs');
const path = require('path');

/**
 * @param {string} filePath - 업로드된 파일 경로 (multer dest)
 * @param {string} ext - 확장자 (.pdf, .docx, .doc 등)
 * @returns {Promise<string>} 추출된 텍스트
 */
async function extractTextFromFile(filePath, ext) {
  const lower = (ext || '').toLowerCase();
  if (lower === '.pdf') {
    return extractPdfText(filePath);
  }
  if (lower === '.docx' || lower === '.doc') {
    return extractDocxText(filePath);
  }
  throw new Error(`지원하지 않는 형식입니다: ${ext}`);
}

async function extractPdfText(filePath) {
  const pdf = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return (data && data.text) ? String(data.text).trim() : '';
}

async function extractDocxText(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  const text = (result && result.value) ? String(result.value).trim() : '';
  if (result.messages && result.messages.length > 0) {
    console.warn('[mammoth]', result.messages);
  }
  return text;
}

module.exports = { extractTextFromFile };
