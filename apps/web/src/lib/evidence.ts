import {
  allowedEvidenceMediaTypes,
  evidenceLimits,
  normalizeReportAttachments,
  sha256Hex,
  type RelayAttachment,
} from '@ghostwhistle/core';

const mediaTypeByExtension: Record<string, string> = {
  csv: 'text/csv',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webp: 'image/webp',
};

export const evidenceAccept = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.json';

export async function prepareEvidenceFile(file: File): Promise<RelayAttachment> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mediaType = file.type.toLowerCase() || mediaTypeByExtension[extension] || '';
  if (!allowedEvidenceMediaTypes.has(mediaType)) {
    throw new Error(`${file.name}: 이미지, PDF, TXT, CSV, JSON 파일만 첨부할 수 있습니다.`);
  }
  if (file.size <= 0) throw new Error(`${file.name}: 빈 파일은 첨부할 수 없습니다.`);
  if (file.size > evidenceLimits.maxFileBytes) {
    throw new Error(`${file.name}: 파일 하나는 5MB 이하여야 합니다.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [metadata] = normalizeReportAttachments([
    {
      name: file.name,
      mediaType,
      size: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    },
  ]);

  return { ...metadata, contentBase64: bytesToBase64(bytes) };
}

export function validateEvidenceSelection(files: readonly RelayAttachment[]): void {
  if (files.length > evidenceLimits.maxFiles) {
    throw new Error(`파일은 최대 ${evidenceLimits.maxFiles}개까지 첨부할 수 있습니다.`);
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > evidenceLimits.maxTotalBytes) {
    throw new Error('첨부파일 전체 크기는 10MB 이하여야 합니다.');
  }
  normalizeReportAttachments(files);
}

export function formatEvidenceSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
