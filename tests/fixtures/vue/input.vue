<template>
<div class="counter" :class="{active:count>0}"><span>{{label}}: {{ count }}</span>
<button type="button" :disabled="count<=0" @click="change(-1)" aria-label="Decrease the counter by one">-</button><button type="button" @click="change(1)">+</button></div>
</template>
<script setup lang="ts">
import {ref} from "vue"
const props=defineProps<{label:string,initial?:number}>()
const count=ref(props.initial??0)
function change(delta:number){count.value+=delta}
</script>
<style scoped>
.counter{display:flex;gap:8px}.active{font-weight:bold}
</style>
