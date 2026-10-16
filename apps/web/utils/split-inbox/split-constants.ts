export const MAX_MAIL_SPLITS = 14;

/**
 * 每个标签运行一次服务商查询，且各自携带自己的分页令牌，因此
 * 更宽的分类会既扇出又使分页游标无限增长。
 */
export const MAX_SPLIT_LABELS = 5;
