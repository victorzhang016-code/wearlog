# Quick Outfit 推荐重构 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 Quick Outfit 改成“单一主推荐 + 完整单品直搭 + 轻量历史参考”，让用户快速读懂替换关系、成立原因并用反馈校准后续推荐。

**Architecture:** 保留现有确定性 `AnalysisRun` 作为证据输入，在 `aestheticRecommendation.ts` 增加两条推荐来源：Best Match 单槽位替换和完整单品直搭。推荐投影输出统一的来源、动作、基础部件和单句理由；页面只消费这个投影，服务端事件继续保存推荐快照和反馈。

**Tech Stack:** React 19、TypeScript、Vite、Supabase/Vercel API、Node test runner、tsx。

---

### Task 1: 固定推荐投影合同与完整基础穿法规则

**Files:**
- Modify: `test/aesthetic-productization.test.ts`
- Modify: `src/lib/aestheticRecommendation.ts`

**Step 1: Write the failing tests**

补充以下行为测试：

- 单槽位替换结果包含当前单品、来源 Best Match、替换槽位和单句理由；
- 单品直搭必须包含 `tops`、`bottoms`、`shoes`，并保留来源中的多个 `tops` 条目作为外衣/内搭结构；
- 直搭最多一个 `accessories`，没有完整基础部件时不生成结果；
- 直搭的完整组合不能等于历史 Best Match 或其变体；
- 新推荐排在参考推荐之前，参考顺序为原始 Best Match、轻微变体、边界变体；
- 推荐输出稳定，不因输入数组原始顺序改变排序。

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/aesthetic-productization.test.ts`

Expected: FAIL，因为当前投影只有 `new/history` 两类，且没有直搭完整性和参考排序合同。

**Step 3: Implement the minimal projection changes**

- 为 `OutfitRecommendation` 增加 `origin: 'replacement' | 'direct' | 'reference'`；
- 增加基础穿法判断：至少包含 `tops`、`bottoms`、`shoes`，`tops` 保留模板中原有的多个位置，`accessories` 最多一个；
- 生成直搭时从完整 Best Match 模板中替换当前单品对应位置，使用颜色/语义 atom/搭配案例关系计算确定性分数；
- 用完整 `selectionKey` 排除历史组合、重复组合和精确拒绝组合；
- 参考投影只保留一个原始 Best Match、一个轻微变体和一个边界变体，并限制配饰数量。

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/aesthetic-productization.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add test/aesthetic-productization.test.ts src/lib/aestheticRecommendation.ts
git commit -m "feat: add complete direct outfit recommendations"
```

### Task 2: 把合适/不合适反馈接入确定性分析

**Files:**
- Modify: `test/aesthetic-productization.test.ts`
- Modify: `src/lib/aestheticProduct.ts`
- Modify: `src/lib/recommendationEvents.ts`
- Modify: `src/lib/recommendationApi.ts`
- Modify: `api/outfit/recommendations/[key]/events.ts`
- Modify: `supabase/migrations/202608160001_aesthetic_productization.sql`

**Step 1: Write the failing tests**

- `marked_suitable` 进入正向终态；
- `marked_unsuitable` 必须带原因才能写入；
- `skipped` 不改变推荐的正负判断；
- 同一推荐被拒绝后，下一轮生成不会返回相同完整组合；
- `selected_for_wear` 与 `marked_suitable` 语义分开。

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/aesthetic-productization.test.ts`

Expected: FAIL，因为当前事件只有实穿状态，没有“合适/不合适”终态。

**Step 3: Implement the minimal feedback changes**

- 增加正向/负向推荐反馈事件类型；
- 新增统一的本地反馈保存函数，写入 `ManualFeedback`，使 `buildLiveAestheticRun` 下一次重算时直接排除精确反例；
- 服务端校验负向事件必须有 reason，并保留推荐快照；
- 同步更新 migration 的 event check constraint。

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/aesthetic-productization.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add test/aesthetic-productization.test.ts src/lib/aestheticProduct.ts src/lib/recommendationEvents.ts src/lib/recommendationApi.ts api/outfit/recommendations/[key]/events.ts supabase/migrations/202608160001_aesthetic_productization.sql
git commit -m "feat: train outfit recommendations from fit feedback"
```

### Task 3: 重做 Quick Outfit 首屏信息层级

**Files:**
- Modify: `src/components/QuickOutfitPage.tsx`

**Step 1: Write the failing test**

如果当前项目没有组件测试，则以投影合同测试作为 UI 输入边界，并先在组件中替换显示模型：主卡必须读取 `origin`、`sourceMatch`、`changedSlot`、`replacedItem` 和单句 `reason`。

**Step 2: Implement the minimal UI changes**

- 主卡只展示当前单品、来源 Best Match/单品直搭、替换位置、原单品、单句理由；
- 将完整穿法改成紧凑视觉带，避免 8 格图片和重复清单抢夺首屏；
- 主操作改为“合适 / 不太合适 / 换下一套”，保留“今天穿”作为次级动作；
- 不合适打开必填理由输入框；
- 主推荐耗尽后给出明确空态，并展示下方参考区；
- 参考区按正统 Best Match、轻微变体、边界变体排序；
- 渲染时再次限制配饰最多一个，避免同一位置堆叠。

**Step 3: Run checks**

Run: `npm run lint`

Expected: PASS。

**Step 4: Commit**

```bash
git add src/components/QuickOutfitPage.tsx
git commit -m "feat: simplify quick outfit decision surface"
```

### Task 4: 集成验证与文档状态同步

**Files:**
- Modify: `docs/PROJECT-STATUS.md`
- Modify: `docs/plans/2026-08-16-wearlog-2.0-product-update-plan.md`

**Step 1: Run the complete verification set**

```bash
npm run test:aesthetic
npx tsx --test test/aesthetic-analysis-v3.test.ts test/aesthetic-productization.test.ts
npm run lint
npm run build
```

Expected: 全部通过。允许记录现有的 chunk 体积和 Supabase 动静态导入 warning，但不能有类型错误或构建失败。

**Step 2: Manually verify the local flow**

- 从单品进入 Quick Outfit；
- 先读出当前单品、来源、替换位置和理由；
- 连续切换替换推荐和直搭推荐；
- 提交合适与不合适反馈，确认不合适必须有理由；
- 刷新后确认精确拒绝组合不再出现；
- 确认参考区最多三个，并且配饰不堆叠。

**Step 3: Update status docs**

记录代码已实现、Development migration 和真实用户验证仍待执行，Production 不宣称已部署。

**Step 4: Commit**

```bash
git add docs/PROJECT-STATUS.md docs/plans/2026-08-16-wearlog-2.0-product-update-plan.md
git commit -m "docs: record quick outfit recommendation redesign"
```
