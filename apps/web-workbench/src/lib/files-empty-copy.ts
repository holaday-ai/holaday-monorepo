export type FileFilter = 'all' | 'images' | 'videos' | 'documents';

export function filesEmptyCopy({
  query,
  filter,
}: {
  query: string;
  filter: FileFilter;
}): { title: string; body: string } {
  const hasQuery = query.trim().length > 0;
  if (hasQuery) {
    return {
      title: '没有匹配的文件',
      body: '换个关键词，或清空搜索后查看全部文件。',
    };
  }

  if (filter === 'images') {
    return {
      title: '还没有图片',
      body: '在任务输入框点 + 号上传图片，之后会出现在这里。',
    };
  }

  if (filter === 'documents') {
    return {
      title: '还没有文件',
      body: '上传 PDF、表格、文本或办公文档后，可以在这里预览和复用。',
    };
  }

  if (filter === 'videos') {
    return {
      title: '还没有视频',
      body: '上传或生成视频后，可以在这里预览、下载和复用。',
    };
  }

  return {
    title: '还没有文件',
    body: '在任务输入框点 + 号上传文件，文件会出现在这里。',
  };
}
