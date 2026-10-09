select u.id,u.name,count(o.id) as order_count,sum(o.total) as revenue from users u left join orders o on o.user_id=u.id and o.status in ('paid','shipped') where u.created_at>='2024-01-01' and (u.country='US' or u.country='CA') group by u.id,u.name having count(o.id)>0 order by revenue desc limit 10;
insert into audit_log(user_id,action,created_at) values (1,'login',now()),(2,'logout',now());
update users set last_seen=now(),login_count=login_count+1 where id=1;
