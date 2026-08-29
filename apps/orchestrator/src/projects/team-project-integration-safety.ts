export const PROJECT_TASK_FOREIGN_KEY_QUERY = `
  SELECT
    rc.CONSTRAINT_NAME AS constraintName,
    kcu.TABLE_NAME AS tableName,
    kcu.COLUMN_NAME AS columnName,
    kcu.REFERENCED_TABLE_NAME AS referencedTableName,
    kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
    rc.DELETE_RULE AS deleteRule
  FROM information_schema.REFERENTIAL_CONSTRAINTS AS rc
  INNER JOIN information_schema.KEY_COLUMN_USAGE AS kcu
    ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
    AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
    AND kcu.TABLE_NAME = rc.TABLE_NAME
  WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
    AND kcu.TABLE_SCHEMA = DATABASE()
    AND rc.TABLE_NAME = 'tasks'
    AND rc.REFERENCED_TABLE_NAME = 'projects'
`;

export type ProjectTaskForeignKeyRow = {
  constraintName: string;
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
  deleteRule: string;
};

export function assertExactProjectTaskForeignKey(rows: readonly ProjectTaskForeignKeyRow[]): void {
  const [foreignKey] = rows;
  if (
    rows.length !== 1 ||
    !foreignKey ||
    foreignKey.tableName !== 'tasks' ||
    foreignKey.columnName !== 'project_id' ||
    foreignKey.referencedTableName !== 'projects' ||
    foreignKey.referencedColumnName !== 'id' ||
    foreignKey.deleteRule !== 'SET NULL'
  ) {
    throw new Error(
      'integration database must have exactly tasks.project_id -> projects.id ON DELETE SET NULL',
    );
  }
}
