<script>
  import { onMount, afterUpdate, tick, onDestroy } from "svelte";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import {
    pb,
    lessons,
    courses,
    progress,
    lessonProgress,
    lesson_faqs,
    lesson_resources,
    currentUser,
    fetchRecords,
    updateProgressStatus,
    saveLessonProgress,
    getLessonProgress,
    markLessonCompleted,
  } from "../lib/pocketbase";
  import { cleanFileName } from "../lib/strConverter";
  import { navigate, useLocation } from "svelte-routing";
  import Sidebar from "../components/Sidebar.svelte";
  import {
    isSidebarVisible,
    isLoading,
    getStoredLessons,
    storeLessons,
    showAlert,
  } from "../lib/store";
  import Plyr from "plyr";
  import Icon from "@iconify/svelte";
  import slugify from "slugify";
  import NotFound from "./NotFound.svelte";
  import Title from "../components/Title.svelte";
  import { t } from "../lib/i18n";
  export let lessonTitle;

  let loading = {};
  let lessonVideo;
  let youtubePlayer;
  let currentCourseStatus = "";
  let currentLessonTitle = "";
  let currentLessonProgress = null;
  let progressSaveInterval;
  let youtubeProgressInterval;

  const lessonLocation = useLocation();

  onMount(async () => {
    if ($currentUser) {
      $isLoading = true;
      await fetchRecords();
      $isLoading = false;
      
      if (window.YT && window.YT.Player) {
        initializeYouTubeAPI();
      } else {
        loadYouTubeAPI();
      }
    } else {
      navigate("/login");
    }
  });

  onDestroy(() => {
    if (progressSaveInterval) {
      clearInterval(progressSaveInterval);
    }
    if (youtubeProgressInterval) {
      clearInterval(youtubeProgressInterval);
    }
  });

  function loadYouTubeAPI() {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      
      window.onYouTubeIframeAPIReady = initializeYouTubeAPI;
    }
  }

  function initializeYouTubeAPI() {
    // YouTube API is ready, we'll initialize players when needed
  }

  afterUpdate(() => {
    initializeVideoPlayers();
  });

  async function initializeVideoPlayers() {
    const currentLesson = $lessons.find(
      (lesson) =>
        slugify(lesson.title, { lower: true, strict: true }) ===
        slugify(lessonTitle, { lower: true, strict: true }),
    );

    if (!currentLesson) return;

    currentLessonProgress = $lessonProgress.find(
      p => p.lesson === currentLesson.id
    );

    if (currentLesson.video) {
      initializeLocalVideo(currentLesson);
    }

    if (currentLesson.videoLocal) {
      initializeLocalVideoFromPath(currentLesson);
    }

    if (currentLesson.videoRemoteUrl && getYouTubeVideoId(currentLesson.videoRemoteUrl)) {
      initializeYouTubeVideo(currentLesson);
    }
  }

  function initializeLocalVideo(lesson) {
    const videoElement = document.getElementById("lessonVideo");
    if (!videoElement || lessonVideo) return;

    lessonVideo = new Plyr("#lessonVideo", {
      invertTime: false,
      toggleInvert: false,
      captions: {
        active: true,
        update: true,
      },
    });

    setupVideoProgressTracking(lessonVideo, lesson, "local");
  }

  function initializeLocalVideoFromPath(lesson) {
    const videoElement = document.getElementById("lessonVideoLocal");
    if (!videoElement) return;

    const localVideo = new Plyr("#lessonVideoLocal", {
      invertTime: false,
      toggleInvert: false,
      captions: {
        active: true,
        update: true,
      },
    });

    setupVideoProgressTracking(localVideo, lesson, "local");
  }

  function initializeYouTubeVideo(lesson) {
    const youtubeContainer = document.getElementById("youtube-player");
    if (!youtubeContainer || !window.YT || youtubePlayer) return;

    const videoId = getYouTubeVideoId(lesson.videoRemoteUrl);
    
    youtubePlayer = new window.YT.Player('youtube-player', {
      height: '100%',
      width: '100%',
      videoId: videoId,
      playerVars: {
        'rel': 0,
        'modestbranding': 1,
        'playsinline': 1
      },
      events: {
        'onReady': (event) => setupYouTubeProgressTracking(event.target, lesson),
        'onStateChange': (event) => handleYouTubeStateChange(event, lesson)
      }
    });
  }

  function setupVideoProgressTracking(player, lesson, videoType) {
    const progressData = $lessonProgress.find(p => p.lesson === lesson.id);
    
    player.on('loadedmetadata', () => {
      if (progressData && progressData.currentTime > 0) {
        player.currentTime = progressData.currentTime;
        showAlert(`Resumed from ${formatTime(progressData.currentTime)}`, "info");
      }
    });

    player.on('timeupdate', () => {
      const currentTime = player.currentTime;
      const duration = player.duration;
      
      if (duration > 0) {
        saveLessonProgress(lesson.id, currentTime, duration, videoType, false);
      }
    });

    player.on('ended', () => {
      markLessonCompleted(lesson.id, videoType);
      showAlert("Lesson completed!", "success");
    });
  }

  function setupYouTubeProgressTracking(player, lesson) {
    const progressData = $lessonProgress.find(p => p.lesson === lesson.id);
    
    if (progressData && progressData.currentTime > 0) {
      player.seekTo(progressData.currentTime, true);
      showAlert(`Resumed from ${formatTime(progressData.currentTime)}`, "info");
    }

    youtubeProgressInterval = setInterval(() => {
      if (player.getPlayerState() === window.YT.PlayerState.PLAYING) {
        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();
        
        if (duration > 0) {
          saveLessonProgress(lesson.id, currentTime, duration, "youtube", false);
        }
      }
    }, 5000);
  }

  function handleYouTubeStateChange(event, lesson) {
    if (event.data === window.YT.PlayerState.ENDED) {
      markLessonCompleted(lesson.id, "youtube");
      showAlert("Lesson completed!", "success");
    }
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  function getProgressPercentage(lessonId) {
    const progressData = $lessonProgress.find(p => p.lesson === lessonId);
    if (!progressData || !progressData.duration) return 0;
    return (progressData.currentTime / progressData.duration) * 100;
  }

  // find the current course status
  $: {
    const currentLesson = $lessons.find(
      (lesson) =>
        slugify(lesson.title, { lower: true, strict: true }) ===
        slugify(lessonTitle, { lower: true, strict: true }),
    );
    if (currentLesson) {
      currentLessonTitle = currentLesson.title;
      const currentCourse = $courses.find(
        (course) => course.id === currentLesson.course,
      );
      if (currentCourse) {
        const currentStatus = $progress.find(
          (progressRecord) => progressRecord.course === currentCourse.id,
        );
        if (currentStatus) {
          currentCourseStatus = currentStatus.status;
        }
      }
    }
  }

  // function to get lessons of the current course
  function getCourseLessons(courseId) {
    return $lessons.filter((lesson) => lesson.course === courseId);
  }

  // function to find the index of the current lesson within its course
  function findCurrentLessonIndex(courseLessons) {
    return courseLessons.findIndex(
      (lesson) =>
        slugify(lesson.title, { lower: true, strict: true }) ===
        slugify(lessonTitle, { lower: true, strict: true }),
    );
  }

  // function to navigate to the next lesson within the same course
  function goToNextLesson() {
    const currentLesson = $lessons.find(
      (lesson) =>
        slugify(lesson.title, { lower: true, strict: true }) ===
        slugify(lessonTitle, { lower: true, strict: true }),
    );
    if (currentLesson) {
      const courseLessons = getCourseLessons(currentLesson.course);
      const currentLessonIndex = findCurrentLessonIndex(courseLessons);
      if (
        currentLessonIndex >= 0 &&
        currentLessonIndex < courseLessons.length - 1
      ) {
        const nextLesson = courseLessons[currentLessonIndex + 1];
        navigate(
          `/${slugify(nextLesson.title, { lower: true, strict: true })}`,
        );

        const lessonsByCourse = getStoredLessons();
        lessonsByCourse[nextLesson.course] = nextLesson;
        storeLessons(lessonsByCourse);
      }
    }
  }

  // function to navigate to the previous lesson within the same course
  function goToPreviousLesson() {
    const currentLesson = $lessons.find(
      (lesson) =>
        slugify(lesson.title, { lower: true, strict: true }) ===
        slugify(lessonTitle, { lower: true, strict: true }),
    );
    if (currentLesson) {
      const courseLessons = getCourseLessons(currentLesson.course);
      const currentLessonIndex = findCurrentLessonIndex(courseLessons);
      if (currentLessonIndex > 0) {
        const previousLesson = courseLessons[currentLessonIndex - 1];
        navigate(
          `/${slugify(previousLesson.title, { lower: true, strict: true })}`,
        );

        const lessonsByCourse = getStoredLessons();
        lessonsByCourse[previousLesson.course] = previousLesson;
        storeLessons(lessonsByCourse);
      }
    }
  }

  // function to complete a course and update the progress status to "Completed"
  async function completeCourse(lessonId) {
    const currentLesson = $lessons.find(
      (lesson) =>
        slugify(lesson.title, { lower: true, strict: true }) ===
        slugify(lessonTitle, { lower: true, strict: true }),
    );
    const currentCourse = $courses.find(
      (course) => course.id === currentLesson.course,
    );
    const progressRecord = $progress.find(
      (progressRecord) => progressRecord.course === currentCourse.id,
    );

    if (progressRecord.status === "In Progress") {
      loading[lessonId] = true;
      const updatedProgressRecord = await updateProgressStatus(
        progressRecord.id,
        "Completed",
      );

      if (!updatedProgressRecord) {
        loading[lessonId] = false;
      }

      if (updatedProgressRecord) {
        await tick();

        $progress = $progress.map((progressRecord) => {
          if (progressRecord.course === currentCourse.id) {
            return { ...progressRecord, status: "Completed" };
          }
          return progressRecord;
        });

        loading[lessonId] = false;

        navigate("/");

        showAlert(
          `${currentCourse.title.length > 30 ? currentCourse.title.slice(0, 30) + "..." : currentCourse.title} completed successfully`,
          "success",
        );
      }
    }
  }

  // function to extract YouTube video ID from URL
  function getYouTubeVideoId(url) {
    if (!url) return null;
    
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    
    return (match && match[2].length === 11) ? match[2] : null;
  }
</script>

<Title title={currentLessonTitle} />

{#if $currentUser}
  <main class="flex h-dvh justify-between lg:overflow-x-hidden">
    <Sidebar isCoursesVisible={false} />
    {#if $isLoading}
      <div class="flex w-full flex-col gap-5 p-5">
        <div class="flex items-center gap-3">
          <button
            on:click={() => ($isSidebarVisible = !$isSidebarVisible)}
            class="group flex items-center justify-center rounded-full bg-transparent p-2 text-xl transition hover:bg-white/10"
          >
            <Icon
              class="flex-shrink-0 text-white/50 transition group-hover:text-white"
              icon="ph:list"
            />
          </button>
          <div class="w-1/2 animate-pulse rounded-full bg-white/10 p-1"></div>
        </div>
        <div
          class="flex w-full flex-grow animate-pulse items-center justify-center rounded-md bg-white/10 p-5"
        >
          <Icon
            class="flex-shrink-0 text-6xl text-white/10"
            icon="svg-spinners:bars-scale-fade"
          />
        </div>
      </div>
    {:else if $lessons.length === 0 || $lessons.every((lesson) => slugify( lesson.title, { lower: true, strict: true }, ) !== $lessonLocation.pathname.slice(1))}
      <NotFound page="lesson" />
    {:else}
      {#each $lessons as lesson (lesson.id)}
        {#if slugify( lesson.title, { lower: true, strict: true }, ) === slugify( lessonTitle, { lower: true, strict: true }, )}
          <section
            class={$lesson_faqs.filter((faq) => faq.lesson.includes(lesson.id))
              .length > 0 ||
            $lesson_resources.filter((resource) =>
              resource.lesson.includes(lesson.id),
            ).length > 0 ||
            lesson.downloads.length > 0
              ? "flex flex-1 flex-col justify-between gap-5 overflow-y-scroll bg-dark p-5"
              : "flex flex-1 flex-col justify-between overflow-y-scroll bg-dark p-5"}
          >
            <div class="space-y-5">
              <button
                on:click={() => navigate("/")}
                class="flex items-center gap-2 text-white/50 transition hover:text-white"
              >
                <Icon class="flex-shrink-0" icon="ph:arrow-left" />
                {$t("myCourses")}</button
              >
              <div
                class="flex items-end justify-between gap-5 sm:w-full sm:flex-col sm:items-start sm:gap-3"
              >
                <div class="flex items-center gap-3">
                  <button
                    on:click={() => ($isSidebarVisible = !$isSidebarVisible)}
                    class="group flex items-center justify-center rounded-full bg-transparent p-2 text-xl transition hover:bg-white/10"
                  >
                    <Icon
                      class="flex-shrink-0 text-white/50 transition group-hover:text-white"
                      icon="ph:list"
                    />
                  </button>
                  <h1 class="text-balance text-xl lg:text-lg">
                    {lesson.title}
                  </h1>
                </div>

                {#if currentCourseStatus === "In Progress" || currentCourseStatus === "Completed"}
                  <div class="flex items-center gap-3 sm:w-full sm:flex-col">
                    {#if !findCurrentLessonIndex(getCourseLessons($lessons.find((lesson) => slugify( lesson.title, { lower: true, strict: true }, ) === slugify( lessonTitle, { lower: true, strict: true }, )).course)) <= 0}
                      <button
                        on:click={goToPreviousLesson}
                        class="line-clamp-1 flex items-center justify-center gap-2 truncate rounded-md bg-white/10 px-4 py-2 outline outline-[1.5px] outline-white/20 transition hover:bg-white/20 sm:order-last sm:w-full"
                      >
                        <Icon class="flex-shrink-0" icon="ph:arrow-left" />
                        {$t("previousLesson")}
                      </button>
                    {/if}

                    {#if findCurrentLessonIndex(getCourseLessons($lessons.find((lesson) => slugify( lesson.title, { lower: true, strict: true }, ) === slugify( lessonTitle, { lower: true, strict: true }, )).course)) >= getCourseLessons($lessons.find((lesson) => slugify( lesson.title, { lower: true, strict: true }, ) === slugify( lessonTitle, { lower: true, strict: true }, )).course).length - 1}
                      <button
                        on:click={() => completeCourse(lesson.id)}
                        class={loading[lesson.id] ||
                        currentCourseStatus === "Completed"
                          ? "pointer-events-none line-clamp-1 flex items-center justify-center gap-2 truncate rounded-md bg-emerald-400/60 px-4 py-2 opacity-50 transition hover:bg-emerald-400/50 sm:order-first sm:w-full"
                          : "line-clamp-1 flex items-center justify-center gap-2 truncate rounded-md bg-emerald-400/60 px-4 py-2 transition hover:bg-emerald-400/50 sm:order-first sm:w-full"}
                      >
                        {currentCourseStatus === "Completed"
                          ? $t("courseCompleted")
                          : $t("completeCourse")}
                        {#if loading[lesson.id]}
                          <Icon
                            class="flex-shrink-0 animate-spin text-base"
                            icon="fluent:spinner-ios-16-regular"
                          />
                        {:else}
                          <Icon class="flex-shrink-0" icon="ph:check" />
                        {/if}
                      </button>
                    {:else}
                      <button
                        on:click={goToNextLesson}
                        class="line-clamp-1 flex items-center justify-center gap-2 truncate rounded-md bg-main px-4 py-2 transition hover:bg-main/80 sm:order-first sm:w-full"
                      >
                        {$t("nextLesson")}
                        <Icon class="flex-shrink-0" icon="ph:arrow-right" />
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>

              {#if lesson.video}
                <video
                  controls
                  crossorigin
                  playsinline
                  id="lessonVideo"
                  data-poster={pb.files.getUrl(lesson, lesson.thumbnail)}
                >
                  <source src={pb.files.getUrl(lesson, lesson.video)} />
                  <track
                    kind="captions"
                    label="English captions"
                    src={pb.files.getUrl(lesson, lesson.captions)}
                    srclang="en"
                    default
                  />
                </video>
              {/if}

              {#if lesson.videoLocal}
                 <video
                   controls
                   crossorigin
                   playsinline
                   id="lessonVideoLocal"
                   data-poster={pb.files.getUrl(lesson, lesson.thumbnail)}
                 >
                   <source src={`${window.location.origin}${lesson.videoLocal}`} />
                   <track
                     kind="captions"
                     label="English captions"
                     src={pb.files.getUrl(lesson, lesson.captions)}
                     srclang="en"
                     default
                   />
                 </video>
              {/if}

              {#if lesson.videoRemoteUrl && getYouTubeVideoId(lesson.videoRemoteUrl)}
                <div class="relative aspect-video w-full overflow-hidden rounded-md">
                  <div id="youtube-player" class="absolute inset-0 h-full w-full"></div>
                </div>
              {/if}

              {#if lesson.content}
                <div
                  class="flex w-full items-center justify-center rounded-md bg-white/5 p-[rfs(50px)] sm:p-5"
                >
                  <article
                    class="flex w-full max-w-[1280px] flex-1 flex-col gap-5 prose-headings:leading-tight prose-h1:text-50px prose-h2:text-40px prose-h3:text-30px prose-h4:text-25px prose-h5:text-20px prose-h6:text-18px prose-p:text-base prose-p:leading-relaxed prose-p:text-white/50 prose-a:text-base prose-a:text-main prose-a:underline prose-a:underline-offset-4 prose-blockquote:w-fit prose-blockquote:rounded-md prose-blockquote:border-l-2 prose-blockquote:border-l-white/50 prose-blockquote:bg-white/5 prose-blockquote:p-5 prose-strong:text-white prose-code:text-base prose-code:text-white/50 prose-ol:list-inside prose-ol:list-decimal prose-ol:space-y-2 prose-ol:text-base
                    prose-ul:list-inside prose-ul:list-disc prose-ul:space-y-2 prose-ul:text-base prose-img:w-full prose-img:rounded-md"
                  >
                    {@html lesson.content}
                  </article>
                </div>
              {/if}

              {#if lesson.summary}
                <div class="space-y-2">
                  <h3 class="flex items-center gap-2 text-base">
                    <Icon icon="ph:text-align-left flex-shrink-0" />
                    {$t("summary")}
                  </h3>
                  <p class="text-white/50">
                    {lesson.summary}
                  </p>
                </div>
              {/if}
            </div>

            <div
              class="flex w-full items-start justify-between gap-5 md:flex-col"
            >
              {#if $lesson_faqs.filter( (faq) => faq.lesson.includes(lesson.id), ).length > 0}
                <div class="flex-1 space-y-4 md:w-full">
                  <h2 class="flex items-center gap-2 text-base">
                    <Icon class="flex-shrink-0" icon="ph:chats" />
                    FAQs
                  </h2>
                  {#each $lesson_faqs as faq}
                    {#if faq.lesson.includes(lesson.id)}
                      <button
                        on:click={() => (faq.isOpen = !faq.isOpen)}
                        class="w-full space-y-2 rounded-md bg-white/10 p-2 outline outline-[1.5px] outline-white/20 transition hover:bg-white/20"
                      >
                        <div
                          class="flex items-center justify-between gap-2 text-start"
                        >
                          <h3 class="line-clamp-1">
                            {faq.question}
                          </h3>
                          <Icon
                            class={faq.isOpen
                              ? "flex-shrink-0 rotate-45 transition"
                              : "flex-shrink-0 transition"}
                            icon="ph:plus"
                          />
                        </div>
                        {#if faq.isOpen}
                          <p
                            transition:slide={{
                              duration: 250,
                              easing: quintOut,
                            }}
                            class="text-start text-white/60"
                          >
                            {faq.answer}
                          </p>
                        {/if}
                      </button>
                    {/if}
                  {/each}
                </div>
              {/if}

              {#if $lesson_resources.filter( (resource) => resource.lesson.includes(lesson.id), ).length > 0}
                <div class="flex-1 space-y-4 md:w-full">
                  <h2 class="flex items-center gap-2 text-base">
                    <Icon class="flex-shrink-0" icon="ph:link" />
                    Resources
                  </h2>
                  {#each $lesson_resources as resource}
                    {#if resource.lesson.includes(lesson.id)}
                      <a
                        href={resource.link}
                        target="_blank"
                        class="block w-full rounded-md bg-white/10 p-2 outline outline-[1.5px] outline-white/20 transition hover:bg-white/20"
                      >
                        <div class="flex items-center justify-between gap-2">
                          <h3 class="line-clamp-1">{resource.name}</h3>
                          <Icon
                            class="flex-shrink-0"
                            icon="ph:arrow-up-right"
                          />
                        </div>
                      </a>
                    {/if}
                  {/each}
                </div>
              {/if}

              {#if lesson.downloads.length > 0}
                <div class="flex-1 space-y-4 md:w-full">
                  <h2 class="flex items-center gap-2 text-base">
                    <Icon class="flex-shrink-0" icon="ph:file" />
                    {$t("downloads")}
                  </h2>
                  {#each lesson.downloads as download}
                    <a
                      href={pb.files.getUrl(lesson, download)}
                      download
                      class="block w-full rounded-md bg-white/10 p-2 outline outline-[1.5px] outline-white/20 transition hover:bg-white/20"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <h3 class="line-clamp-1">{cleanFileName(download)}</h3>
                        <Icon class="flex-shrink-0" icon="ph:download-simple" />
                      </div>
                    </a>
                  {/each}
                </div>
              {/if}
            </div>
          </section>
        {/if}
      {/each}
    {/if}
  </main>
{/if}
