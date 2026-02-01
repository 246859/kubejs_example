// KubeJS - 删除特定合成配方
// 移除Create模组的安山合金和强力胶的合成配方

ServerEvents.recipes(event => {
  // 删除安山合金的合成配方 (Create模组)
  event.remove({ output: 'create:andesite_alloy' });
  
  // 删除强力胶的合成配方 (Create模组)
  event.remove({ output: 'create:super_glue' });
  
  // 删除拆解台的合成配方 (暮色森林模组)
  event.remove({ output: 'twilightforest:uncrafting_table' });
  
  console.log('[RecipeRemover] Create模组的安山合金和强力胶、暮色森林的拆解台合成配方已移除');
});