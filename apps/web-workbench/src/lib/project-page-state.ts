export const PROJECT_NAME_MAX_LENGTH = 100;

export interface ProjectNameState {
  readonly name: string;
  readonly length: number;
  readonly remaining: number;
  readonly error: string | null;
  readonly canSubmit: boolean;
}

export function normalizeProjectName(value: string): string {
  return value.trim();
}

export function projectNameState(
  value: string,
  existingNames: readonly string[] = [],
): ProjectNameState {
  const name = normalizeProjectName(value);
  const duplicateNames = new Set(
    existingNames.map((existingName) => normalizeProjectName(existingName).toLocaleLowerCase()),
  );
  const length = value.length;
  let error: string | null = null;

  if (!name) {
    error = '请输入项目名称';
  } else if (length > PROJECT_NAME_MAX_LENGTH) {
    error = `项目名称不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符`;
  } else if (duplicateNames.has(name.toLocaleLowerCase())) {
    error = '已有同名项目';
  }

  return {
    name,
    length,
    remaining: PROJECT_NAME_MAX_LENGTH - length,
    error,
    canSubmit: error === null,
  };
}

export function projectCountSummary(options: {
  readonly count: number;
  readonly loading: boolean;
  readonly error: string | null;
}): string {
  if (options.loading && options.count > 0)
    return `正在刷新 ${options.count} 个项目…`;
  if (options.loading) return '项目加载中…';
  if (options.error && options.count > 0)
    return `共 ${options.count} 个项目，上次刷新失败`;
  if (options.error) return '项目加载失败';
  if (options.count === 0) return '尚无项目';
  return `共 ${options.count} 个项目`;
}
