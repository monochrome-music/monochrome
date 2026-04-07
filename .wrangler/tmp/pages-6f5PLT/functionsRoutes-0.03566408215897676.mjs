import { onRequest as __album_t__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\album\\t\\[id].js"
import { onRequest as __artist_t__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\artist\\t\\[id].js"
import { onRequest as __playlist_t__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\playlist\\t\\[id].js"
import { onRequest as __track_t__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\track\\t\\[id].js"
import { onRequest as __api_label_index_js_onRequest } from "D:\\projects\\monochrome\\functions\\api\\label\\index.js"
import { onRequest as __album__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\album\\[id].js"
import { onRequest as __artist__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\artist\\[id].js"
import { onRequest as __playlist__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\playlist\\[id].js"
import { onRequest as __podcasts__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\podcasts\\[id].js"
import { onRequest as __track__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\track\\[id].js"
import { onRequest as __user___username__js_onRequest } from "D:\\projects\\monochrome\\functions\\user\\@[username].js"
import { onRequest as __userplaylist__id__js_onRequest } from "D:\\projects\\monochrome\\functions\\userplaylist\\[id].js"

export const routes = [
    {
      routePath: "/album/t/:id",
      mountPath: "/album/t",
      method: "",
      middlewares: [],
      modules: [__album_t__id__js_onRequest],
    },
  {
      routePath: "/artist/t/:id",
      mountPath: "/artist/t",
      method: "",
      middlewares: [],
      modules: [__artist_t__id__js_onRequest],
    },
  {
      routePath: "/playlist/t/:id",
      mountPath: "/playlist/t",
      method: "",
      middlewares: [],
      modules: [__playlist_t__id__js_onRequest],
    },
  {
      routePath: "/track/t/:id",
      mountPath: "/track/t",
      method: "",
      middlewares: [],
      modules: [__track_t__id__js_onRequest],
    },
  {
      routePath: "/api/label",
      mountPath: "/api/label",
      method: "",
      middlewares: [],
      modules: [__api_label_index_js_onRequest],
    },
  {
      routePath: "/album/:id",
      mountPath: "/album",
      method: "",
      middlewares: [],
      modules: [__album__id__js_onRequest],
    },
  {
      routePath: "/artist/:id",
      mountPath: "/artist",
      method: "",
      middlewares: [],
      modules: [__artist__id__js_onRequest],
    },
  {
      routePath: "/playlist/:id",
      mountPath: "/playlist",
      method: "",
      middlewares: [],
      modules: [__playlist__id__js_onRequest],
    },
  {
      routePath: "/podcasts/:id",
      mountPath: "/podcasts",
      method: "",
      middlewares: [],
      modules: [__podcasts__id__js_onRequest],
    },
  {
      routePath: "/track/:id",
      mountPath: "/track",
      method: "",
      middlewares: [],
      modules: [__track__id__js_onRequest],
    },
  {
      routePath: "/user/@:username",
      mountPath: "/user",
      method: "",
      middlewares: [],
      modules: [__user___username__js_onRequest],
    },
  {
      routePath: "/userplaylist/:id",
      mountPath: "/userplaylist",
      method: "",
      middlewares: [],
      modules: [__userplaylist__id__js_onRequest],
    },
  ]