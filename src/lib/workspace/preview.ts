type PreviewableWorkspaceFile =
  | {
      content: string;
      isPrimary?: boolean;
      nodeType?: 'file' | 'folder';
      path: string;
      type?: string;
    }
  | null
  | undefined;

export type WorkspacePreviewCapability =
  | {
      canPreview: true;
      entryPath: 'index.html' | 'package.json';
      reason: string;
      target: 'static-html' | 'dev-server';
    }
  | {
      canPreview: false;
      entryPath: null;
      reason: string;
      target: null;
    };

export function detectWorkspacePreviewCapability(
  files: PreviewableWorkspaceFile[]
): WorkspacePreviewCapability {
  const packageJsonFile = files.find((file) => {
    if (!file) {
      return false;
    }

    return isFileNode(file) && file.path === 'package.json';
  });

  if (packageJsonFile) {
    try {
      const parsed = JSON.parse(packageJsonFile.content) as {
        scripts?: Record<string, string>;
      };

      if (parsed.scripts?.dev) {
        return {
          canPreview: true,
          entryPath: 'package.json',
          reason: 'Preview can start from the workspace dev script.',
          target: 'dev-server',
        };
      }
    } catch {
      // Fall through so the caller sees the more actionable fallback reason below.
    }
  }

  const staticIndexFile = files.find((file) => {
    if (!file) {
      return false;
    }

    return isFileNode(file) && file.path === 'index.html';
  });

  if (staticIndexFile && looksLikeHtmlDocument(staticIndexFile.content)) {
    return {
      canPreview: true,
      entryPath: 'index.html',
      reason: 'Preview can start from the static index.html entrypoint.',
      target: 'static-html',
    };
  }

  const legacyHtmlSource = findLegacyHtmlPreviewSource(files);
  if (legacyHtmlSource) {
    return {
      canPreview: true,
      entryPath: 'index.html',
      reason: `Preview can start from the legacy HTML source in ${legacyHtmlSource.path}.`,
      target: 'static-html',
    };
  }

  return {
    canPreview: false,
    entryPath: null,
    reason:
      'No preview target is available yet. Add an index.html file or a package.json with a dev script.',
    target: null,
  };
}

function isFileNode(file: PreviewableWorkspaceFile) {
  if (!file) {
    return false;
  }

  if (file.nodeType) {
    return file.nodeType === 'file';
  }

  return file.type !== 'folder';
}

export function findLegacyHtmlPreviewSource(files: PreviewableWorkspaceFile[]) {
  const fileCandidates = files.filter((file): file is Exclude<PreviewableWorkspaceFile, null | undefined> => {
    if (!file) {
      return false;
    }

    return isFileNode(file);
  });
  const preferredOrder = [...fileCandidates].sort((left, right) => {
    if (Boolean(left.isPrimary) === Boolean(right.isPrimary)) {
      return left.path.localeCompare(right.path);
    }

    return left.isPrimary ? -1 : 1;
  });

  return (
    preferredOrder.find((file) => {
      if (file.path === 'index.html' || file.path === 'package.json') {
        return false;
      }

      return looksLikeHtmlDocument(file.content);
    }) || null
  );
}

export function looksLikeHtmlDocument(content: string) {
  const normalized = content.trim().toLowerCase();
  return (
    normalized.startsWith('<!doctype html') ||
    normalized.startsWith('<html') ||
    (normalized.includes('<head') && normalized.includes('<body'))
  );
}
