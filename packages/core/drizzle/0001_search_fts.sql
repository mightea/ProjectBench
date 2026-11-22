-- Full-text index over projects, checklist items and notes.
-- Rows are written by the service layer in the same transaction as each change.
CREATE VIRTUAL TABLE `search` USING fts5(
  `entity`,
  `entity_id` UNINDEXED,
  `project_id` UNINDEXED,
  `title`,
  `body`,
  tokenize = 'unicode61 remove_diacritics 2'
);
