<template>
    <div>
        <div class="space-y-1 flex gap-4">
            <Avatar>
                <AvatarImage :src="tgUser.photo_url" alt="@unovue" />
                <AvatarFallback>{{ tgUser.first_name.at(0) }}</AvatarFallback>
            </Avatar>
            <div class="flex flex-col">
                <span> {{ tgUser.first_name }} {{ tgUser.last_name }} </span>
                <a v-if="tgUser.first_name" :href="`https://${tgUser.username}.t.me/`"> @{{ tgUser.username }} </a>
            </div>
            <div>
                <Button variant="ghost" @click="deleteTgLink">
                    <Trash />
                </Button>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Trash } from 'lucide-vue-next';
import { useApi } from '@/store/apiStore';
import { useToast } from '@/components/ui/toast';

const { toast } = useToast()

const props = defineProps<{
    data: IUserSocialIntegrationDto
}>();

const e = defineEmits<{
  (e: 'deleted', id: Guid): void
}>()

const api = useApi();

const tgUser = computed(() => JSON.parse(props.data.UserData) as {
    id: number,
    username: string,
    photo_url: string,
    first_name: string,
    last_name: string
});


const deleteTgLink = async () => {
    var result = await api.userInteraction.DeleteSocialBound("Telegram", props.data.SocialId);

    if (result) 
        e("deleted", props.data.SocialId);
    else 
    {
        toast({
            title: "Failed to delete action",
            variant: "destructive",
            type: "foreground"
        })
    }
}

</script>