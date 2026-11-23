-- Adds project tags to the full-text index. FTS5 tables can't gain columns, so it is rebuilt.
CREATE VIRTUAL TABLE `search_new` USING fts5(
  `entity`,
  `entity_id` UNINDEXED,
  `project_id` UNINDEXED,
  `title`,
  `body`,
  `tags`,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
INSERT INTO `search_new` (`entity`, `entity_id`, `project_id`, `title`, `body`, `tags`)
SELECT s.`entity`, s.`entity_id`, s.`project_id`, s.`title`, s.`body`,
  CASE WHEN s.`entity` = 'project' THEN coalesce((
    SELECT group_concat(t.`name`, ' ')
    FROM `project_tags` pt JOIN `tags` t ON t.`id` = pt.`tag_id`
    WHERE pt.`project_id` = s.`project_id`
  ), '') ELSE '' END
FROM `search` s;
--> statement-breakpoint
DROP TABLE `search`;
--> statement-breakpoint
ALTER TABLE `search_new` RENAME TO `search`;
