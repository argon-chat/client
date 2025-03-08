<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

// Интерфейс для экшенов
interface Action {
    id: number;
    name: string;
    hotkey: string;
}

const actions = ref<Action[]>([
    { id: 1, name: "Перек", hotkey: "Ctrl + S" },
    { id: 2, name: "Открыть", hotkey: "Ctrl + O" },
    { id: 3, name: "Закрыть", hotkey: "Ctrl + W" },
]);

const editingId = ref<number | null>(null);
const pressedKeys = ref<Set<string>>(new Set());
const lastKeyCode = ref<{ code: string, keyCode: number } | null>(null); 

const modifiers = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"]);

const normalizeKey = (code: string): string => {
    const replacements: Record<string, string> = {
        ControlLeft: "Ctrl",
        ControlRight: "Ctrl",
        AltLeft: "Alt",
        AltRight: "Alt",
        ShiftLeft: "Shift",
        ShiftRight: "Shift",
        MetaLeft: "Win",
        MetaRight: "Win",
    };
    return replacements[code] || code.toUpperCase();
};

const hotkeyString = computed(() => {
    const keys = Array.from(pressedKeys.value);
    return keys.join(" + ");
});

const startListening = (id: number) => {
    editingId.value = id;
    pressedKeys.value.clear();
    lastKeyCode.value = null;
};

const stopListening = () => {
    if (editingId.value !== null && lastKeyCode.value !== null) {
        const action = actions.value.find((a) => a.id === editingId.value);
        if (action) {
            action.hotkey = `${hotkeyString.value} + ${lastKeyCode.value.code}`;
        }

        const hotkeyObject = {
            keyCode: lastKeyCode.value.keyCode,
            hasCtrl: pressedKeys.value.has("Ctrl"),
            hasAlt: pressedKeys.value.has("Alt"),
            hasWin: pressedKeys.value.has("Win"),
            hasShift: pressedKeys.value.has("Shift"),
        };

        console.log(hotkeyObject);
    }

    editingId.value = null;
    pressedKeys.value.clear();
    lastKeyCode.value = null;
};

const handleKeyDown = (event: KeyboardEvent) => {
    if (editingId.value === null) return;
    event.preventDefault();

    console.log(event);
    const key = normalizeKey(event.code);

    if (modifiers.has(event.code)) {
        pressedKeys.value.add(key); 
    } else {
        lastKeyCode.value = { keyCode: event.keyCode, code: event.code }; 
    }
};

const handleKeyUp = (event: KeyboardEvent) => {
    if (editingId.value === null) return;
    event.preventDefault(); 
    setTimeout(() => stopListening(), 10);
};

onMounted(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
});
</script>

<template>
    <div class="p-4">
        <table class="w-full border border-gray-300">
            <thead>
                <tr class="bg-gray-100">
                    <th class="border px-4 py-2 text-left">Действие</th>
                    <th class="border px-4 py-2 text-left">Горячая клавиша</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="action in actions" :key="action.id" class="border">
                    <td class="px-4 py-2">{{ action.name }}</td>
                    <td class="px-4 py-2">
                        <input v-if="editingId === action.id" type="text"
                            class="border px-2 py-1 w-full focus:outline-none"
                            placeholder="Нажмите комбинацию клавиш..." readonly :value="hotkeyString"
                            @blur="stopListening" />
                        <span v-else class="cursor-pointer text-blue-600 hover:underline"
                            @click="startListening(action.id)">
                            {{ action.hotkey }}
                        </span>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
