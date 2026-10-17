import {useEffect,useState} from 'react'
const key='logspoll-favorites'
export function parseFavorites(value:string|null):string[]{try{const data:unknown=JSON.parse(value??'[]');return Array.isArray(data)?[...new Set(data.filter((id):id is string=>typeof id==='string'&&/^[a-f\d-]{36}$/i.test(id)))].slice(0,100):[]}catch{return []}}
export function useFavorites(){
 const [favorites,setFavorites]=useState<string[]>(()=>{try{return parseFavorites(localStorage.getItem(key))}catch{return []}})
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(favorites))}catch{/* Favorites still work for this page. */}},[favorites])
 function toggleFavorite(id:string){setFavorites(previous=>previous.includes(id)?previous.filter(value=>value!==id):[id,...previous].slice(0,100))}
 return {favorites,toggleFavorite}
}
