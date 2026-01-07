## Summary
- ChatPageにWeb検索機能を追加
- Bedrock Converse APIのTool Use機能を使用してLLMが検索が必要かどうかを判断
- 検索結果を活用した回答生成を実装
- 検索の過程と結果をチャット画面に表示

## Changes
- Web検索トグルスイッチをチャット入力欄に配置
- Brave Search API / Tavily Search APIに対応
- 検索ユーティリティをagent.tsから分離してwebSearch.tsとして再利用可能に
- 検索結果を通常のテキストメッセージとして会話履歴に追加（toolConfig不要）
- 検索の過程（検索中・検索結果）を回答生成後も保持

## Test plan
- [x] Web検索を有効にして「最近のニュースを教えて下さい」等のクエリで検索が実行されることを確認
- [x] 検索結果を基にした回答が生成されることを確認
- [x] 検索の過程と結果が回答生成後も表示されることを確認
- [ ] Web検索を無効にした場合は通常の回答が生成されることを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
