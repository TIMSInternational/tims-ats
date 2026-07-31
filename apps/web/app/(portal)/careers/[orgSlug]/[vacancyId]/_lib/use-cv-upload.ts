'use client';

import { useState, useCallback } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { validateCvFile, type CvValidationError } from './cv-validation';

type CvUploadError = CvValidationError | 'upload_failed';

interface UseCvUploadResult {
  file: File | null;
  error: CvUploadError | null;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removeFile: () => void;
  uploadCvIfNeeded: () => Promise<{ cvFileKey?: string; cvFileName?: string }>;
  uploading: boolean;
}

export function useCvUpload(vacancyId: string): UseCvUploadResult {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<CvUploadError | null>(null);
  const [uploading, setUploading] = useState(false);
  const getUploadUrlMutation = trpc.portal.getCvUploadUrl.useMutation();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!selected) return;
    const validationError = validateCvFile(selected);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    setError(null);
    setFile(selected);
  }, []);

  const removeFile = useCallback(() => {
    setFile(null);
    setError(null);
  }, []);

  const uploadCvIfNeeded = useCallback(async (): Promise<{ cvFileKey?: string; cvFileName?: string }> => {
    if (!file) return {};
    setUploading(true);
    try {
      const { url, fields, key } = await getUploadUrlMutation.mutateAsync({
        vacancyId,
        fileName: file.name,
        contentType: file.type as
          | 'application/pdf'
          | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);
      const uploadRes = await fetch(url, { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('S3 upload failed');
      return { cvFileKey: key, cvFileName: file.name };
    } catch {
      setError('upload_failed');
      throw new Error('cv_upload_failed');
    } finally {
      setUploading(false);
    }
  }, [file, getUploadUrlMutation, vacancyId]);

  return { file, error, handleFileChange, removeFile, uploadCvIfNeeded, uploading };
}
