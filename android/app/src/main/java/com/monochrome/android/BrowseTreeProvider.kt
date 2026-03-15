package com.monochrome.android

import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat

/**
 * Manages the media browse tree that Android Auto navigates.
 *
 * Current structure:
 *   ROOT
 *   └── QUEUE  ("Now Playing Queue")
 *         ├── track 0
 *         ├── track 1
 *         └── ...
 *
 * The queue items are populated via [updateQueue] whenever the JS bridge
 * reports a queue change (TODO: wire that callback up in MusicService).
 */
class BrowseTreeProvider {

    companion object {
        const val ROOT_ID = "root"
        const val QUEUE_ID = "queue"
    }

    data class QueueItem(
        val id: String,
        val title: String,
        val artist: String,
        val album: String,
    )

    private val queue = mutableListOf<QueueItem>()

    fun updateQueue(items: List<QueueItem>) {
        queue.clear()
        queue.addAll(items)
    }

    fun getChildren(parentId: String): List<MediaBrowserCompat.MediaItem> =
        when (parentId) {
            ROOT_ID -> rootItems()
            QUEUE_ID -> queueItems()
            else -> emptyList()
        }

    private fun rootItems(): List<MediaBrowserCompat.MediaItem> {
        val desc = MediaDescriptionCompat.Builder()
            .setMediaId(QUEUE_ID)
            .setTitle("Now Playing Queue")
            .setSubtitle("${queue.size} tracks")
            .build()
        return listOf(
            MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE)
        )
    }

    private fun queueItems(): List<MediaBrowserCompat.MediaItem> =
        queue.map { item ->
            val desc = MediaDescriptionCompat.Builder()
                .setMediaId(item.id)
                .setTitle(item.title)
                .setSubtitle(item.artist)
                .setDescription(item.album)
                .build()
            MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)
        }
}
