import PocketBase from "pocketbase";
import { writable } from "svelte/store";
import { showAlert } from "./store";

export const pb = new PocketBase(
  import.meta.env.DEV
    ? import.meta.env.VITE_DEV_PB_URL
    : import.meta.env.VITE_PROD_PB_URL,
);

export const currentUser = writable(pb.authStore.model);
export const courses = writable([]);
export const lessons = writable([]);
export const progress = writable([]);
export const lessonProgress = writable([]);
export const resources = writable([]);
export const lesson_faqs = writable([]);
export const lesson_resources = writable([]);

pb.authStore.onChange(() => {
  currentUser.set(pb.authStore.model);
});

// function to fetch all the records from PocketBase
export const fetchRecords = async () => {
  try {
    const courseRecords = await pb.collection("courses").getFullList({
      sort: "created",
    });

    const lessonRecords = await pb.collection("lessons").getFullList({
      sort: "created",
    });

    const progressRecords = await pb.collection("progress").getFullList({
      sort: "created",
    });

    const lessonProgressRecords = await pb.collection("lesson_progress").getFullList({
      sort: "created",
      filter: `user = "${pb.authStore.model?.id}"`,
    });

    const resourceRecords = await pb.collection("resources").getFullList({
      sort: "created",
    });

    const lessonFaqsRecords = await pb.collection("lesson_faqs").getFullList({
      sort: "created",
    });

    const lessonResourcesRecords = await pb
      .collection("lesson_resources")
      .getFullList({
        sort: "created",
      });

    courses.set(courseRecords);
    lessons.set(lessonRecords);
    progress.set(progressRecords);
    lessonProgress.set(lessonProgressRecords);
    resources.set(resourceRecords);
    lesson_faqs.set(lessonFaqsRecords);
    lesson_resources.set(lessonResourcesRecords);
  } catch (error) {
    showAlert("Failed to load data. Please try again", "fail");
  }
};

// function to update the progress status for a user
export const updateProgressStatus = async (progressRecordId, newStatus) => {
  try {
    const data = {
      status: newStatus,
    };
    const progressRecord = await pb
      .collection("progress")
      .update(progressRecordId, data);
    return progressRecord;
  } catch (error) {
    showAlert("Failed to update course status. Please try again", "fail");
  }
};

// function to save or update lesson video progress
export const saveLessonProgress = async (lessonId, currentTime, duration, videoType = "local", completed = false) => {
  try {
    const userId = pb.authStore.model?.id;
    if (!userId) return null;

    const filter = `lesson = "${lessonId}" && user = "${userId}"`;
    const existingRecords = await pb.collection("lesson_progress").getList(1, 1, { filter });

    const data = {
      lesson: lessonId,
      user: userId,
      currentTime: currentTime,
      duration: duration,
      videoType: videoType,
      completed: completed,
    };

    let progressRecord;
    if (existingRecords.items.length > 0) {
      progressRecord = await pb.collection("lesson_progress").update(existingRecords.items[0].id, data);
    } else {
      progressRecord = await pb.collection("lesson_progress").create(data);
    }

    lessonProgress.update(records => {
      const index = records.findIndex(r => r.lesson === lessonId && r.user === userId);
      if (index >= 0) {
        records[index] = progressRecord;
      } else {
        records.push(progressRecord);
      }
      return records;
    });

    return progressRecord;
  } catch (error) {
    console.error("Failed to save lesson progress:", error);
    return null;
  }
};

// function to get lesson progress for a specific lesson
export const getLessonProgress = async (lessonId) => {
  try {
    const userId = pb.authStore.model?.id;
    if (!userId) return null;

    const filter = `lesson = "${lessonId}" && user = "${userId}"`;
    const records = await pb.collection("lesson_progress").getList(1, 1, { filter });
    
    return records.items.length > 0 ? records.items[0] : null;
  } catch (error) {
    console.error("Failed to get lesson progress:", error);
    return null;
  }
};

// function to mark lesson as completed
export const markLessonCompleted = async (lessonId, videoType = "local") => {
  try {
    const userId = pb.authStore.model?.id;
    if (!userId) return null;

    const filter = `lesson = "${lessonId}" && user = "${userId}"`;
    const existingRecords = await pb.collection("lesson_progress").getList(1, 1, { filter });

    const data = {
      lesson: lessonId,
      user: userId,
      completed: true,
      videoType: videoType,
    };

    let progressRecord;
    if (existingRecords.items.length > 0) {
      data.currentTime = existingRecords.items[0].currentTime;
      data.duration = existingRecords.items[0].duration;
      progressRecord = await pb.collection("lesson_progress").update(existingRecords.items[0].id, data);
    } else {
      progressRecord = await pb.collection("lesson_progress").create(data);
    }

    lessonProgress.update(records => {
      const index = records.findIndex(r => r.lesson === lessonId && r.user === userId);
      if (index >= 0) {
        records[index] = progressRecord;
      } else {
        records.push(progressRecord);
      }
      return records;
    });

    return progressRecord;
  } catch (error) {
    console.error("Failed to mark lesson as completed:", error);
    return null;
  }
};
